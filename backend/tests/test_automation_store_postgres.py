"""Los adaptadores SQL del motor de automatizaciones, contra PostgreSQL real.

Lo que la aplicación da por hecho de la base —qué se reclama y qué se
congela, cuándo cuenta un intento, que una cancelación no se pise, que un
flujo manual no corra dos veces— solo se puede afirmar acá.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, insert, select, update

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
from app.modules.automations.ports.types import AutomationExecutionStatus
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
            "created_by_user_id": owner,
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


async def test_claiming_runs_what_is_due_even_if_the_lead_has_the_bot_off(tenant):
    with tenant_context(tenant):
        rule_id = await _rule()
        due = await _execution(rule_id, await _lead(), attempts=2)
        # El bot desactivado solo impide lanzamientos nuevos (schedule_in_session):
        # lo que ya estaba en marcha sigue, sea de sistema o manual.
        paused_lead = await _lead(paused=True)
        system = await _execution(rule_id, paused_lead)
        other_paused_lead = await _lead(paused=True)
        manual = await _execution(rule_id, other_paused_lead, start_source="manual")
        future = await _execution(rule_id, await _lead(), scheduled_for=NOW + timedelta(hours=1))

        claimed = await SqlExecutionStore().claim_due(NOW, limit=50)

        assert set(claimed) == {due, system, manual}
        assert future not in claimed
        assert (await _row(system)).status == AutomationExecutionStatus.RUNNING
        claimed_row = await _row(due)
        assert claimed_row.status == AutomationExecutionStatus.RUNNING
        # Reclamar no es recuperar: el contador de intentos no se toca.
        assert claimed_row.attempts == 2


async def test_claiming_takes_one_execution_per_lead_and_queues_the_rest(tenant):
    """Un mensaje entrante dispara varias reglas a la vez; corriendo en
    paralelo, sus mensajes llegaban intercalados al cliente."""
    with tenant_context(tenant):
        rule_id = await _rule()
        lead = await _lead()
        first = await _execution(rule_id, lead, scheduled_for=NOW - timedelta(minutes=2))
        second = await _execution(rule_id, lead)
        other_lead = await _execution(rule_id, await _lead())

        claimed = await SqlExecutionStore().claim_due(NOW, limit=50)

        assert set(claimed) == {first, other_lead}
        assert await SqlExecutionStore().claim_due(NOW, limit=50) == []
        await SqlExecutionStore().save(first, status=AutomationExecutionStatus.COMPLETED)
        assert await SqlExecutionStore().claim_due(NOW, limit=50) == [second]


async def test_a_flow_waiting_halfway_holds_back_new_ones_but_resumes_itself(tenant):
    with tenant_context(tenant):
        rule_id = await _rule()
        lead = await _lead()
        waiting = await _execution(
            rule_id, lead, scheduled_for=NOW + timedelta(hours=1),
            flow_state={"current_node_id": "wait", "path": ["trigger", "send", "wait"]},
        )
        new = await _execution(rule_id, lead)

        assert await SqlExecutionStore().claim_due(NOW, limit=50) == []

        async with session_scope() as session:
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == waiting
            ).values(scheduled_for=NOW - timedelta(minutes=5)))
        assert await SqlExecutionStore().claim_due(NOW, limit=50) == [waiting]
        await SqlExecutionStore().save(waiting, status=AutomationExecutionStatus.COMPLETED)
        assert await SqlExecutionStore().claim_due(NOW, limit=50) == [new]


async def test_a_child_flow_runs_while_its_parent_waits(tenant):
    """«Iniciar otro flujo» no retiene al padre: si el padre sigue con una
    espera, el hijo no puede quedar en cola detrás de él."""
    with tenant_context(tenant):
        rule_id = await _rule()
        lead = await _lead()
        parent = await _execution(
            rule_id, lead, scheduled_for=NOW + timedelta(days=1),
            flow_state={"current_node_id": "wait", "path": ["trigger", "child", "wait"]},
        )
        child = await _execution(
            rule_id, lead, start_source="flow", event_payload={"parent_execution_id": parent},
        )

        assert await SqlExecutionStore().claim_due(NOW, limit=50) == [child]


WAITING = {"current_node_id": "wait", "path": ["trigger", "send", "wait"]}


async def test_a_manual_launch_does_not_queue_behind_a_follow_up_that_is_waiting(tenant):
    """La vendedora tenía que cancelar el seguimiento para mandar un precio:
    el lanzamiento se rechazaba mientras hubiera otra automatización a medias."""
    with tenant_context(tenant):
        rule_id = await _rule()
        lead = await _lead()
        await _execution(rule_id, lead, scheduled_for=NOW + timedelta(hours=1), flow_state=WAITING)
        system = await _execution(rule_id, lead)
        manual = await _execution(rule_id, lead, start_source="manual")

        # Lo de sistema sigue en cola detrás del seguimiento; lo manual, no.
        assert await SqlExecutionStore().claim_due(NOW, limit=50) == [manual]
        assert (await _row(system)).status == AutomationExecutionStatus.SCHEDULED


async def test_the_follow_up_resumes_only_after_the_manual_flow_ends(tenant):
    """Si el seguimiento retomara mientras la secuencia manual espera entre
    dos pasos, el cliente recibiría los mensajes de las dos intercalados."""
    with tenant_context(tenant):
        rule_id = await _rule()
        other_rule = await _rule()
        lead = await _lead()
        follow_up = await _execution(rule_id, lead, flow_state=WAITING)  # su plazo ya venció
        manual = await _execution(
            other_rule, lead, start_source="manual", scheduled_for=NOW + timedelta(minutes=30), flow_state=WAITING,
        )

        assert await SqlExecutionStore().claim_due(NOW, limit=50) == []

        await SqlExecutionStore().save(manual, status=AutomationExecutionStatus.COMPLETED)
        assert await SqlExecutionStore().claim_due(NOW, limit=50) == [follow_up]


async def test_a_manual_flow_frozen_by_hand_does_not_hold_the_follow_up(tenant):
    # Una pausada puede quedar así semanas: no puede retener al seguimiento.
    with tenant_context(tenant):
        rule_id = await _rule()
        other_rule = await _rule()
        lead = await _lead()
        follow_up = await _execution(rule_id, lead, flow_state=WAITING)
        await _execution(
            other_rule, lead, start_source="manual", status=AutomationExecutionStatus.PAUSED, flow_state=WAITING,
        )

        assert await SqlExecutionStore().claim_due(NOW, limit=50) == [follow_up]


async def test_between_two_manual_flows_the_latest_wins_and_neither_deadlocks(tenant):
    with tenant_context(tenant):
        lead = await _lead()
        first = await _execution(await _rule(), lead, start_source="manual", flow_state=WAITING)
        second = await _execution(await _rule(), lead, start_source="manual")

        assert await SqlExecutionStore().claim_due(NOW, limit=50) == [second]
        await SqlExecutionStore().save(second, status=AutomationExecutionStatus.COMPLETED)
        assert await SqlExecutionStore().claim_due(NOW, limit=50) == [first]


async def test_a_manual_flow_still_waits_for_what_is_running_right_now(tenant):
    with tenant_context(tenant):
        rule_id = await _rule()
        lead = await _lead()
        await _execution(rule_id, lead, status=AutomationExecutionStatus.RUNNING)
        await _execution(await _rule(), lead, start_source="manual")

        assert await SqlExecutionStore().claim_due(NOW, limit=50) == []


@pytest.mark.parametrize("stopped", [AutomationExecutionStatus.CANCELLED, AutomationExecutionStatus.SKIPPED])
async def test_a_stopped_execution_is_never_overwritten_by_the_engine(tenant, stopped):
    with tenant_context(tenant):
        execution_id = await _execution(await _rule(), await _lead(), status=stopped)

        saved = await SqlExecutionStore().save(execution_id, status=AutomationExecutionStatus.RUNNING)

        assert saved is False
        assert (await _row(execution_id)).status == stopped


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
    """Lo que la regla anterior dejó congelado con el lead vuelve con el
    tiempo que le faltaba cuando se reactiva el bot."""
    with tenant_context(tenant):
        lead_id = await _lead()
        execution_id = await _execution(
            await _rule(), lead_id, scheduled_for=NOW + timedelta(minutes=20),
            status=AutomationExecutionStatus.PAUSED, paused_at=NOW - timedelta(hours=2), pause_scope="lead",
        )

        assert await SqlExecutionStore().resume_lead(lead_id, NOW) == 1

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
        child_rule = await store.rule(await _rule(flow_version=3))
        parent_id = await _execution(child_rule.id, lead_id)
        parent, _ = await store.load(parent_id)

        first = await store.schedule_child(rule=child_rule, parent=parent, event_key="flow:1:n", payload={}, now=NOW)
        again = await store.schedule_child(rule=child_rule, parent=parent, event_key="flow:1:n", payload={}, now=NOW)

        assert first == again
        assert (await _row(first)).flow_state == {"flow_version": 3, "current_node_id": None, "path": []}


async def test_a_recent_start_of_the_same_flow_for_the_lead_is_found(tenant):
    with tenant_context(tenant):
        lead_id = await _lead()
        store = SqlExecutionStore()
        rule_id = await _rule()
        since = NOW - timedelta(minutes=30)

        async def found():
            return await store.started_for_lead_since(rule_id, lead_id, since, exclude_event_key="flow:1:n")

        assert await found() is None
        # Lo que no envió nada, lo de otro lead, lo viejo y la propia hija no cuentan.
        await _execution(rule_id, lead_id, status=AutomationExecutionStatus.FAILED, start_source="manual")
        await _execution(rule_id, lead_id, status=AutomationExecutionStatus.CANCELLED, start_source="manual")
        await _execution(rule_id, lead_id, status=AutomationExecutionStatus.SKIPPED, start_source="manual")
        await _execution(rule_id, await _lead(), start_source="manual")
        await _execution(rule_id, lead_id, start_source="manual", created_at=NOW - timedelta(minutes=31))
        await _execution(rule_id, lead_id, start_source="flow", event_key="flow:1:n")
        assert await found() is None

        await _execution(rule_id, lead_id, status=AutomationExecutionStatus.COMPLETED, start_source="manual")
        assert await found() == "manual"


async def test_round_robin_turns_are_handed_out_in_order(tenant):
    with tenant_context(tenant):
        rule_id = await _rule()
        store = SqlExecutionStore()

        turns = [await store.advance_round_robin(rule_id, "rr", NOW) for _ in range(3)]

        assert turns == [1, 2, 3]
        assert await store.round_robin_counter(rule_id, "rr") == 3


async def test_a_manual_flow_cannot_run_twice_on_the_same_lead(tenant):
    with tenant_context(tenant):
        rule_id = await _rule()
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


async def test_deleting_a_rule_keeps_history_and_cancels_what_was_pending(tenant):
    with tenant_context(tenant):
        rule_id = await _rule()
        pending = await _execution(rule_id, await _lead())
        rules = SqlRuleStore()

        async with session_scope():
            assert await rules.lock_active_statuses(rule_id) == [AutomationExecutionStatus.SCHEDULED]
            assert await rules.retire(rule_id, NOW) == 1

        assert await rules.get(rule_id) is None
        assert (await _row(pending)).status == AutomationExecutionStatus.CANCELLED
        async with session_scope() as session:
            assert (await session.scalar(select(AutomationRule.deleted_at).where(AutomationRule.id == rule_id))) is not None


async def test_reactivating_the_lead_does_not_step_on_what_the_seller_paused_by_hand(tenant):
    with tenant_context(tenant):
        rule_id = await _rule()
        lead_id = await _lead()
        by_hand = await _execution(rule_id, lead_id)
        old_rule = await _execution(rule_id, lead_id, status=AutomationExecutionStatus.PAUSED, paused_at=NOW, pause_scope="lead")
        legacy = await _execution(rule_id, lead_id, status=AutomationExecutionStatus.PAUSED, paused_at=NOW)
        store = SqlExecutionStore()

        assert await store.pause(by_hand, NOW) is True

        # Las pausas anteriores a la columna (NULL) son de alcance lead.
        assert await store.resume_lead(lead_id, NOW) == 2
        assert (await _row(old_rule)).status == AutomationExecutionStatus.SCHEDULED
        assert (await _row(legacy)).status == AutomationExecutionStatus.SCHEDULED
        assert ((await _row(by_hand)).status, (await _row(by_hand)).pause_scope) == (
            AutomationExecutionStatus.PAUSED, "execution",
        )
        assert await store.resume(by_hand, NOW) is True
        assert await store.resume(by_hand, NOW) is False


async def test_each_seller_message_moves_the_same_silence_deadline(tenant):
    from app.db.models.conversations import WspMessage

    with tenant_context(tenant):
        rule_id = await _rule(trigger_type="customer_response_overdue", trigger_config={"minutes": 30})
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
        assert deadline.scheduled_for == second + timedelta(minutes=30)
        assert deadline.event_payload["last_message_id"] == "seller-2"

        # El cliente contestó: el cierre pendiente queda sin efecto.
        assert await scheduling.cancel_customer_deadlines(lead_id, NOW) == 1
        assert (await _row(deadline.id)).status == AutomationExecutionStatus.SKIPPED


async def _silence_execution(tenant_lead: str, rule_id: int, **flow_state) -> int:
    """Un seguimiento por silencio que ya mandó su primer mensaje y quedó en
    una espera del flujo: SCHEDULED y sin started_at, como una sin empezar."""
    from app.db.models.conversations import WspMessage

    async with session_scope() as session:
        anchor = (await session.execute(insert(WspMessage).values(
            chat_id=tenant_lead, sender="cliente", content="hola", sent_at=NOW - timedelta(hours=5), message_type="text",
        ).returning(WspMessage.id))).scalar_one()
    return await _execution(
        rule_id, tenant_lead, trigger_type="customer_response_overdue", event_key=f"silence:{anchor}",
        scheduled_for=NOW + timedelta(days=1),
        action_results=[{"type": "send_message", "status": "completed"}],
        flow_state={"flow_version": 1, "current_node_id": "wait-1", "path": ["trigger-1", "action-1", "wait-1"], **flow_state},
    )


async def test_a_follow_up_that_is_waiting_does_not_restart_when_its_own_message_goes_out(tenant):
    """El flujo «mensaje → esperar un día → mensaje» volvía al principio en
    cuanto salía su propio primer mensaje, y lo mandaba de nuevo, en bucle."""
    with tenant_context(tenant):
        rule_id = await _rule(trigger_type="customer_response_overdue", trigger_config={"minutes": 30}, flow_version=1)
        lead_id = await _lead()
        waiting = await _silence_execution(lead_id, rule_id)

        changed = await SqlSchedulingStore().schedule_customer_deadlines(
            {"chat_id": lead_id, "message_id": "del-propio-flujo", "sender": "vendedor", "sent_at": NOW},
        )

        row = await _row(waiting)
        assert changed == 0
        assert row.flow_state["current_node_id"] == "wait-1"
        assert row.scheduled_for == NOW + timedelta(days=1)
        assert row.action_results == [{"type": "send_message", "status": "completed"}]


async def test_a_reply_stops_a_waiting_follow_up_but_not_one_waiting_for_that_reply(tenant):
    with tenant_context(tenant):
        rule_id = await _rule(trigger_type="customer_response_overdue", trigger_config={"minutes": 30}, flow_version=1)
        other_rule = await _rule(trigger_type="customer_response_overdue", trigger_config={"minutes": 30}, flow_version=1)
        lead_id = await _lead()
        chasing = await _silence_execution(lead_id, rule_id)
        # Una Pausa con «llega un mensaje»: la respuesta decide por dónde sigue.
        asking = await _silence_execution(lead_id, other_rule, awaiting=["message"])

        assert await SqlSchedulingStore().cancel_customer_deadlines(lead_id, NOW) == 1

        assert (await _row(chasing)).status == AutomationExecutionStatus.SKIPPED
        assert (await _row(asking)).status == AutomationExecutionStatus.SCHEDULED


async def _delivery(execution_id: int) -> tuple[str | None, dict[int, str]]:
    from app.db.models.automations import AutomationExecutionMessage

    async with session_scope() as session:
        messages = dict((await session.execute(
            select(AutomationExecutionMessage.message_id, AutomationExecutionMessage.state)
            .where(AutomationExecutionMessage.execution_id == execution_id)
        )).all())
    return (await _row(execution_id)).delivery_state, messages


async def test_the_delivery_summary_follows_the_messages_of_an_execution(tenant):
    """Una ejecución quedaba «completada» al encolar; que sus mensajes hayan
    salido o no se pierde si nadie lo anota."""
    with tenant_context(tenant):
        execution_id = await _execution(await _rule(), await _lead(), status=AutomationExecutionStatus.COMPLETED)
        store = SqlExecutionStore()
        assert (await _delivery(execution_id))[0] is None  # todavía no mandó nada

        await store.track_messages(execution_id, [9001, 9002], NOW)
        await store.track_messages(execution_id, [9001], NOW)  # repetir no cambia nada
        assert await _delivery(execution_id) == ("pending", {9001: "pending", 9002: "pending"})

        assert await store.record_message_state(9001, "sent", NOW) == execution_id
        assert (await _delivery(execution_id))[0] == "pending"  # falta el otro

        await store.record_message_state(9002, "read", NOW)
        assert (await _delivery(execution_id))[0] == "delivered"

        # Un acuse viejo no retrocede; un rechazo tardío sí cambia el resumen.
        await store.record_message_state(9002, "delivered", NOW)
        assert (await _delivery(execution_id))[1][9002] == "read"
        await store.record_message_state(9001, "failed", NOW)
        assert await _delivery(execution_id) == ("failed", {9001: "failed", 9002: "read"})

        # No se toca el estado del motor: de él dependen el tope por hora y el «no repetir».
        assert (await _row(execution_id)).status == AutomationExecutionStatus.COMPLETED


async def test_a_message_no_execution_sent_is_ignored_and_messages_go_with_their_execution(tenant):
    from app.db.models.automations import AutomationExecutionMessage

    with tenant_context(tenant):
        execution_id = await _execution(await _rule(), await _lead())
        store = SqlExecutionStore()
        await store.track_messages(execution_id, [9100], NOW)

        assert await store.record_message_state(4242, "sent", NOW) is None

        async with session_scope() as session:
            await session.execute(delete(AutomationExecution).where(AutomationExecution.id == execution_id))
        async with session_scope() as session:
            assert (await session.scalar(select(func.count(AutomationExecutionMessage.message_id)))) == 0


async def test_reconciling_rebuilds_the_delivery_from_the_real_messages(tenant):
    """Las ejecuciones anteriores a la cuenta de entrega no tienen nada
    anotado: se reconstruye desde los mensajes que sus pasos dejaron escritos."""
    from app.db.models.conversations import WspMessage
    from app.modules.automations.application.delivery import reconcile_delivery

    async def message(**values) -> int:
        async with session_scope() as session:
            return (await session.execute(insert(WspMessage).values(
                chat_id=lead_id, sender="vendedor", content="hola", sent_at=NOW, message_type="text", **values,
            ).returning(WspMessage.id))).scalar_one()

    with tenant_context(tenant):
        rule_id = await _rule()
        lead_id = await _lead()
        read = await message(outbox_status="sent", meta_status="read")
        accepted = await message(outbox_status="sent")
        lost = await message(outbox_status="failed")
        queued = await message(outbox_status="queued")
        delivered = await _execution(
            rule_id, lead_id, status=AutomationExecutionStatus.COMPLETED, action_results=[{"message_ids": [read]}],
        )
        undelivered = await _execution(
            await _rule(), lead_id, status=AutomationExecutionStatus.COMPLETED,
            action_results=[{"message_ids": [accepted]}, {"message_ids": [lost]}],
        )
        sending = await _execution(
            await _rule(), lead_id, status=AutomationExecutionStatus.COMPLETED, action_results=[{"message_ids": [queued]}],
        )
        no_messages = await _execution(await _rule(), lead_id, status=AutomationExecutionStatus.COMPLETED)

        dry = await reconcile_delivery(apply=False)
        assert dry.changed_executions == 3
        assert (await _row(undelivered)).delivery_state is None  # la simulación no escribe

        await reconcile_delivery(apply=True)

        assert (await _row(delivered)).delivery_state == "delivered"
        assert (await _row(undelivered)).delivery_state == "failed"
        assert (await _row(sending)).delivery_state == "pending"
        assert (await _row(no_messages)).delivery_state is None
        # Ya coincide: reconciliar de nuevo no encuentra nada que corregir.
        assert not (await reconcile_delivery(apply=False)).corrected


async def test_a_team_reply_stops_only_the_system_follow_ups_that_asked_for_it(tenant):
    """«Detener si alguien del equipo le escribe»: corta lo automático que
    estaba pendiente, no lo que una persona lanzó ni lo que no lo pidió."""
    with tenant_context(tenant):
        lead_id = await _lead()
        opted_in = {"conditions": {"stop_when_team_replies": True}}
        waiting = await _execution(await _rule(**opted_in), lead_id, flow_state=WAITING, start_source="system")
        not_started = await _execution(await _rule(**opted_in), lead_id, trigger_type="lead_created", start_source="system")
        # El vencimiento de «cliente sin responder» lo arma justamente ese mensaje.
        deadline = await _execution(
            await _rule(trigger_type="customer_response_overdue", **opted_in), lead_id,
            trigger_type="customer_response_overdue", start_source="system",
        )
        by_hand = await _execution(await _rule(**opted_in), lead_id, flow_state=WAITING, start_source="manual")
        did_not_ask = await _execution(await _rule(), lead_id, flow_state=WAITING, start_source="system")
        other_lead = await _execution(await _rule(**opted_in), await _lead(), flow_state=WAITING, start_source="system")

        assert await SqlSchedulingStore().stop_for_team_reply(lead_id, NOW) == 2

        stopped = await _row(waiting)
        assert (stopped.status, stopped.error) == (AutomationExecutionStatus.CANCELLED, "Alguien del equipo le escribió al cliente")
        assert (await _row(not_started)).status == AutomationExecutionStatus.CANCELLED
        for untouched in (deadline, by_hand, did_not_ask, other_lead):
            assert (await _row(untouched)).status == AutomationExecutionStatus.SCHEDULED


async def test_counts_the_automated_messages_a_lead_got_in_the_window(tenant):
    """La base del tope diario: lo que las automatizaciones le encolaron a un
    cliente, de cualquier flujo, desde un momento dado."""
    with tenant_context(tenant):
        lead_id = await _lead()
        first = await _execution(await _rule(), lead_id)
        second = await _execution(await _rule(), lead_id)
        other = await _execution(await _rule(), await _lead())
        store = SqlExecutionStore()
        await store.track_messages(first, [9301, 9302], NOW - timedelta(hours=30))
        await store.track_messages(first, [9303], NOW - timedelta(hours=2))
        await store.track_messages(second, [9304], NOW - timedelta(minutes=5))
        await store.track_messages(other, [9305], NOW)
        # Un acuse cambia updated_at, no cuándo se encoló.
        await store.record_message_state(9301, "read", NOW)

        assert await store.messages_queued_for_lead_since(lead_id, NOW - timedelta(hours=24)) == 2
        assert await store.messages_queued_for_lead_since(lead_id, NOW - timedelta(hours=48)) == 4
