"""Los adaptadores SQL del motor de automatizaciones, contra PostgreSQL real.

Lo que la aplicación da por hecho de la base —qué se reclama y qué se
congela, cuándo cuenta un intento, que una cancelación no se pise, que un
flujo manual no corra dos veces— solo se puede afirmar acá.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import insert, select, update

from app.db.models.auth import User
from app.db.models.automations import AutomationExecution, AutomationRule
from app.db.models.leads import Lead
from app.db.uow import session_scope
from app.modules.automations.application.ports import ExecutionAlreadyRunning
from app.modules.automations.domain.events import AutomationsChanged, ExecutionFailed
from app.modules.automations.domain.limits import MAX_EXECUTION_ATTEMPTS, STALE_EXECUTION_MINUTES
from app.modules.automations.infrastructure import worker
from app.modules.automations.infrastructure.sql_executions import SqlExecutionStore
from app.modules.automations.infrastructure.sql_rules import SqlRuleStore
from app.modules.automations.infrastructure.sql_scheduling import SqlSchedulingStore
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.tenancy.context import tenant_context
from domain_types import AutomationExecutionStatus
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401

NOW = datetime.now(timezone.utc)


async def _user() -> int:
    async with session_scope() as session:
        user = User(
            email=f"auto-{uuid4().hex[:8]}@example.test", name="Admin", password_hash="!",
            role="admin", is_active=True, created_at=NOW,
        )
        session.add(user)
        await session.flush()
        return user.id


async def _lead(*, paused: bool = False) -> str:
    chat_id = str(uuid4())
    await ensure_lead_stub(chat_id, None, None)
    if paused:
        async with session_scope() as session:
            await session.execute(update(Lead).where(Lead.id == chat_id).values(automatizacion_pausada=True))
    return chat_id


async def _rule(**values) -> int:
    owner = await _user()
    async with session_scope() as session:
        return (await session.execute(insert(AutomationRule).values(**{
            "name": "Regla", "trigger_type": "manual", "trigger_config": {}, "conditions": {},
            "actions": [], "delay_minutes": 0, "created_by_user_id": owner,
            "created_at": NOW, "updated_at": NOW, **values,
        }).returning(AutomationRule.id))).scalar_one()


async def _execution(rule_id: int, lead_id: str | None, **values) -> int:
    async with session_scope() as session:
        return (await session.execute(insert(AutomationExecution).values(**{
            "rule_id": rule_id, "lead_id": lead_id, "trigger_type": "manual",
            "event_key": f"test:{uuid4()}", "status": AutomationExecutionStatus.SCHEDULED,
            "scheduled_for": NOW - timedelta(minutes=1), "created_at": NOW, **values,
        }).returning(AutomationExecution.id))).scalar_one()


async def _row(execution_id: int) -> AutomationExecution:
    async with session_scope() as session:
        return await session.get(AutomationExecution, execution_id)


async def test_claiming_runs_what_is_due_and_freezes_what_a_paused_lead_had(tenant):
    with tenant_context(tenant):
        rule_id = await _rule()
        due = await _execution(rule_id, await _lead(), attempts=2)
        paused_lead = await _lead(paused=True)
        frozen = await _execution(rule_id, paused_lead)
        # Un flujo manual del vendedor nunca lo congela la pausa del lead.
        manual = await _execution(rule_id, paused_lead, start_source="manual")
        future = await _execution(rule_id, await _lead(), scheduled_for=NOW + timedelta(hours=1))

        frozen_ids, claimed = await SqlExecutionStore().claim_due(NOW, limit=50)

        assert frozen_ids == [frozen]
        assert set(claimed) == {due, manual}
        assert future not in claimed
        claimed_row = await _row(due)
        assert claimed_row.status == AutomationExecutionStatus.RUNNING
        # Reclamar no es recuperar: el contador de intentos no se toca.
        assert claimed_row.attempts == 2
        frozen_row = await _row(frozen)
        assert (frozen_row.status, frozen_row.pause_scope) == (AutomationExecutionStatus.PAUSED, "lead")


async def test_a_cancelled_execution_is_never_overwritten_by_the_engine(tenant):
    with tenant_context(tenant):
        execution_id = await _execution(await _rule(), await _lead(), status=AutomationExecutionStatus.SKIPPED)

        saved = await SqlExecutionStore().save(execution_id, status=AutomationExecutionStatus.RUNNING)

        assert saved is False
        assert (await _row(execution_id)).status == AutomationExecutionStatus.SKIPPED


async def test_retrying_resets_attempts_and_records_the_window_override(tenant):
    with tenant_context(tenant):
        admin = await _user()
        execution_id = await _execution(
            await _rule(), await _lead(), status=AutomationExecutionStatus.FAILED, attempts=3,
        )

        requeued = await SqlExecutionStore().requeue(execution_id, NOW, override_by_user_id=admin)

        row = await _row(execution_id)
        assert requeued is True
        assert (row.status, row.attempts, row.window_override_by_user_id) == (
            AutomationExecutionStatus.SCHEDULED, 0, admin,
        )
        assert await SqlExecutionStore().requeue(execution_id, NOW, override_by_user_id=None) is False


async def test_resuming_a_lead_gives_back_the_time_the_wait_had_left(tenant):
    with tenant_context(tenant):
        lead_id = await _lead()
        execution_id = await _execution(await _rule(), lead_id, scheduled_for=NOW + timedelta(minutes=20))
        store = SqlExecutionStore()

        assert await store.pause_lead(lead_id, NOW - timedelta(hours=2)) == 1
        assert await store.resume_lead(lead_id, NOW) == 1

        row = await _row(execution_id)
        assert row.status == AutomationExecutionStatus.SCHEDULED
        assert row.scheduled_for == NOW + timedelta(minutes=20) + timedelta(hours=2)


async def test_a_stale_execution_is_retried_until_it_runs_out_of_attempts(tenant, monkeypatch):
    published = []

    async def record(*events, **_kwargs):
        published.extend(events)

    monkeypatch.setattr(worker, "publish", record)
    with tenant_context(tenant):
        rule_id = await _rule()
        stale_at = NOW - timedelta(minutes=STALE_EXECUTION_MINUTES + 1)
        revived = await _execution(rule_id, await _lead(), status=AutomationExecutionStatus.RUNNING,
                                   started_at=stale_at, attempts=0)
        exhausted = await _execution(rule_id, await _lead(), status=AutomationExecutionStatus.RUNNING,
                                     started_at=stale_at, attempts=MAX_EXECUTION_ATTEMPTS)

        await worker._release_stale_executions()

        revived_row = await _row(revived)
        assert (revived_row.status, revived_row.attempts) == (AutomationExecutionStatus.SCHEDULED, 1)
        assert (await _row(exhausted)).status == AutomationExecutionStatus.FAILED
    assert AutomationsChanged() in published
    [failure] = [event for event in published if isinstance(event, ExecutionFailed)]
    assert (failure.execution_id, failure.rule_id) == (exhausted, rule_id)


async def test_a_child_flow_is_scheduled_once_per_parent_node(tenant):
    with tenant_context(tenant):
        lead_id = await _lead()
        store = SqlExecutionStore()
        child_rule = await store.rule(await _rule(builder_mode="visual", flow_version=3))
        parent_id = await _execution(child_rule.id, lead_id)
        parent, _ = await store.load(parent_id)

        first = await store.schedule_child(rule=child_rule, parent=parent, event_key="flow:1:n", payload={}, now=NOW)
        again = await store.schedule_child(rule=child_rule, parent=parent, event_key="flow:1:n", payload={}, now=NOW)

        assert first == again
        assert (await _row(first)).flow_state == {"flow_version": 3, "current_node_id": None, "path": []}


async def test_round_robin_turns_are_handed_out_in_order(tenant):
    with tenant_context(tenant):
        rule_id = await _rule()
        store = SqlExecutionStore()

        turns = [await store.advance_round_robin(rule_id, "rr", NOW) for _ in range(3)]

        assert turns == [1, 2, 3]
        assert await store.round_robin_counter(rule_id, "rr") == 3


async def test_a_manual_flow_cannot_run_twice_on_the_same_lead(tenant):
    with tenant_context(tenant):
        rule_id = await _rule(builder_mode="visual")
        lead_id = await _lead()
        scheduling = SqlSchedulingStore()

        assert await scheduling.schedule("manual", lead_id, "manual:1", rule_id=rule_id, start_source="manual") == 1
        with pytest.raises(ExecutionAlreadyRunning):
            await scheduling.schedule("manual", lead_id, "manual:2", rule_id=rule_id, start_source="manual")


async def test_system_triggers_respect_the_lead_pause(tenant):
    with tenant_context(tenant):
        await _rule(trigger_type="message_received")
        scheduling = SqlSchedulingStore()

        assert await scheduling.schedule("message_received", await _lead(paused=True), "message:1") == 0
        assert await scheduling.schedule("message_received", await _lead(), "message:1") == 1


async def test_deleting_a_rule_keeps_history_and_skips_what_was_pending(tenant):
    with tenant_context(tenant):
        rule_id = await _rule()
        pending = await _execution(rule_id, await _lead())
        rules = SqlRuleStore()

        async with session_scope():
            assert await rules.lock_active_statuses(rule_id) == [AutomationExecutionStatus.SCHEDULED]
            assert await rules.retire(rule_id, NOW) == 1

        assert await rules.get(rule_id) is None
        assert (await _row(pending)).status == AutomationExecutionStatus.SKIPPED
        async with session_scope() as session:
            assert (await session.scalar(select(AutomationRule.deleted_at).where(AutomationRule.id == rule_id))) is not None


async def test_the_lead_pause_and_the_execution_pause_do_not_step_on_each_other(tenant):
    with tenant_context(tenant):
        rule_id = await _rule()
        lead_id = await _lead()
        system = await _execution(rule_id, lead_id)
        manual = await _execution(rule_id, lead_id, start_source="manual")
        by_hand = await _execution(rule_id, lead_id)
        legacy = await _execution(rule_id, lead_id, status=AutomationExecutionStatus.PAUSED, paused_at=NOW)
        store = SqlExecutionStore()

        assert await store.pause(by_hand, NOW) is True
        assert await store.pause_lead(lead_id, NOW) == 1
        assert (await _row(manual)).status == AutomationExecutionStatus.SCHEDULED
        assert (await _row(system)).pause_scope == "lead"

        # Las pausas anteriores a la columna (NULL) son de alcance lead.
        assert await store.resume_lead(lead_id, NOW) == 2
        assert (await _row(legacy)).status == AutomationExecutionStatus.SCHEDULED
        assert ((await _row(by_hand)).status, (await _row(by_hand)).pause_scope) == (
            AutomationExecutionStatus.PAUSED, "execution",
        )
        assert await store.resume(by_hand, NOW) is True
        assert await store.resume(by_hand, NOW) is False


async def test_each_seller_message_moves_the_same_silence_deadline(tenant):
    from app.db.models.conversations import WspMessage

    with tenant_context(tenant):
        rule_id = await _rule(trigger_type="customer_response_overdue", trigger_config={"minutes": 30}, delay_minutes=5)
        lead_id = await _lead()
        async with session_scope() as session:
            await session.execute(insert(WspMessage).values(
                chat_id=lead_id, sender="cliente", content="hola", sent_at=NOW - timedelta(hours=1), message_type="text",
            ))
        scheduling = SqlSchedulingStore()

        first = NOW - timedelta(minutes=10)
        second = NOW
        assert await scheduling.schedule_customer_deadlines(
            {"chat_id": lead_id, "message_id": "seller-1", "sender": "vendedor", "sent_at": first},
        ) == 1
        assert await scheduling.schedule_customer_deadlines(
            {"chat_id": lead_id, "message_id": "seller-2", "sender": "vendedor", "sent_at": second},
        ) == 1

        async with session_scope() as session:
            rows = (await session.execute(select(AutomationExecution).where(
                AutomationExecution.rule_id == rule_id,
            ))).scalars().all()
        [deadline] = rows
        assert deadline.scheduled_for == second + timedelta(minutes=35)
        assert deadline.event_payload["last_message_id"] == "seller-2"

        # El cliente contestó: el cierre pendiente queda sin efecto.
        assert await scheduling.cancel_customer_deadlines(lead_id, NOW) == 1
        assert (await _row(deadline.id)).status == AutomationExecutionStatus.SKIPPED
