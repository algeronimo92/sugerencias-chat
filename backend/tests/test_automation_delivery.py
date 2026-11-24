"""Qué pasó con los mensajes que mandó una ejecución, aparte de si recorrió
sus pasos. Había «completadas» con mensajes que nunca salieron."""

import dataclasses

import pytest

from app.modules.automations import subscribers
from app.modules.automations.application.actions import with_outbox_dedupe
from app.modules.automations.domain.delivery import ExecutionDeliveryState, advance, summarize
from app.modules.conversations.public import MessageDiscarded, MessageFailed, MessageSent, MessageStatusChanged


class TestAdvance:
    @pytest.mark.parametrize(("current", "incoming", "expected"), [
        ("pending", "sent", "sent"),
        ("sent", "delivered", "delivered"),
        ("delivered", "read", "read"),
        # Meta reintenta y desordena: un acuse viejo no pisa uno más nuevo.
        ("read", "delivered", "read"),
        ("delivered", "sent", "delivered"),
        # Un rechazo tardío gana siempre, y ya no se mueve.
        ("delivered", "failed", "failed"),
        ("failed", "read", "failed"),
        # Un estado que todavía no conocemos no rompe ni cambia nada.
        ("sent", "played", "sent"),
    ])
    def test_a_message_only_moves_forward(self, current, incoming, expected):
        assert advance(current, incoming) == expected


class TestSummarize:
    @pytest.mark.parametrize(("states", "expected"), [
        ([], None),
        (["pending"], ExecutionDeliveryState.PENDING),
        (["sent", "pending"], ExecutionDeliveryState.PENDING),
        (["sent", "delivered", "read"], ExecutionDeliveryState.DELIVERED),
        # Con uno que no salió, la ejecución no se entregó aunque el resto sí.
        (["read", "failed", "pending"], ExecutionDeliveryState.FAILED),
    ])
    def test_the_worst_message_decides(self, states, expected):
        assert summarize(states) == expected

    def test_unread_is_not_a_problem(self):
        # El cliente puede tener apagada la confirmación de lectura.
        assert summarize(["delivered", "sent"]) == ExecutionDeliveryState.DELIVERED


async def test_the_engine_notes_which_messages_an_execution_queued(deps, executions):
    async def enqueue(chat_id, items):
        return [{"id": 700 + index, **item} for index, item in enumerate(items)]

    wrapped = with_outbox_dedupe(dataclasses.replace(deps, enqueue_messages=enqueue), execution_id=5, position=2)

    sent = await wrapped.enqueue_messages("chat-1", [{"message": {}}, {"message": {}}])

    assert [message["id"] for message in sent] == [700, 701]
    assert executions.messages == {700: (5, "pending"), 701: (5, "pending")}


@pytest.fixture
def tracked(in_memory_automations):
    store = in_memory_automations.executions
    store.messages[700] = (5, "pending")
    return store


class TestDeliveryEvents:
    async def test_sent_then_read_then_a_stale_delivered(self, tracked):
        await subscribers.note_message_sent(MessageSent(chat_id="c", message_id=700, actor_user_id=None))
        await subscribers.note_message_status(MessageStatusChanged(chat_id="c", message_id=700, meta_status="read"))
        await subscribers.note_message_status(MessageStatusChanged(chat_id="c", message_id=700, meta_status="delivered"))

        assert tracked.messages[700] == (5, "read")

    async def test_a_final_failure_marks_the_message_failed(self, tracked):
        await subscribers.note_message_failed(MessageFailed(chat_id="c", message_id=700))

        assert tracked.messages[700] == (5, "failed")

    async def test_a_discarded_message_was_not_delivered_either(self, tracked):
        await subscribers.note_message_discarded(MessageDiscarded(chat_id="c", message_id=700))

        assert tracked.messages[700] == (5, "failed")

    async def test_a_late_rejection_from_whatsapp_overrides_sent(self, tracked):
        await subscribers.note_message_sent(MessageSent(chat_id="c", message_id=700, actor_user_id=None))
        await subscribers.note_message_status(MessageStatusChanged(chat_id="c", message_id=700, meta_status="failed"))

        assert tracked.messages[700] == (5, "failed")

    async def test_resending_a_failed_message_clears_the_failure(self, tracked):
        """Quien reenvía desde «Por atender» un mensaje que no salió espera que
        deje de figurar como no entregado cuando WhatsApp lo acepta."""
        await subscribers.note_message_failed(MessageFailed(chat_id="c", message_id=700))
        await subscribers.note_message_sent(MessageSent(chat_id="c", message_id=700, actor_user_id=None))

        assert tracked.messages[700] == (5, "sent")

    async def test_a_late_sent_ack_from_meta_does_not_clear_a_failure(self, tracked):
        # El «enviado» de Meta puede llegar después de su propio rechazo.
        await subscribers.note_message_status(MessageStatusChanged(chat_id="c", message_id=700, meta_status="failed"))
        await subscribers.note_message_status(MessageStatusChanged(chat_id="c", message_id=700, meta_status="sent"))

        assert tracked.messages[700] == (5, "failed")

    async def test_messages_that_no_automation_sent_are_ignored(self, tracked):
        # Lo que escribe una vendedora pasa por los mismos avisos.
        await subscribers.note_message_sent(MessageSent(chat_id="c", message_id=999, actor_user_id=7))
        await subscribers.note_message_status(MessageStatusChanged(chat_id="c", message_id=700, meta_status="played"))

        assert tracked.messages == {700: (5, "pending")}


class TestMessageIdsIn:
    def test_collects_the_ids_each_step_left_without_repeating(self):
        from app.modules.automations.domain.delivery import message_ids_in

        results = [
            {"type": "send_message", "message_ids": [10]},
            {"type": "create_task", "task_id": 3},
            {"type": "send_media", "message_ids": [11, 10, 12]},
        ]
        assert message_ids_in(results) == [10, 11, 12]

    @pytest.mark.parametrize("broken", [None, {}, "x", [None, 3, {"message_ids": "no"}, {"message_ids": [True, "7", None]}]])
    def test_survives_old_or_malformed_results(self, broken):
        from app.modules.automations.domain.delivery import message_ids_in

        assert message_ids_in(broken) == []


class TestDeliveryStateOf:
    @pytest.mark.parametrize(("outbox", "meta", "expected"), [
        ("queued", None, "pending"),
        ("sending", None, "pending"),
        ("retryable_failed", None, "pending"),
        ("sent", None, "sent"),
        ("sent", "delivered", "delivered"),
        ("sent", "read", "read"),
        # Aceptado por la cola y rechazado después por WhatsApp.
        ("sent", "failed", "failed"),
        ("failed", None, "failed"),
        ("discarded", None, "failed"),
        # Uno entrante o escrito desde el teléfono: no pasó por la cola.
        (None, None, None),
    ])
    def test_meta_wins_over_the_queue(self, outbox, meta, expected):
        from app.modules.conversations.domain.delivery import delivery_state_of

        assert delivery_state_of(outbox, meta) == expected


class TestReconcile:
    @pytest.fixture
    def world(self, in_memory_automations):
        from tests.automation_fakes import execution as stored_execution

        store = in_memory_automations.executions
        # 1: anterior a la cuenta, nada anotado. 2: un aviso perdido. 3: al día. 4: sin mensajes.
        store.add(stored_execution(id=1, action_results=[{"message_ids": [10, 11]}]))
        store.add(stored_execution(id=2, action_results=[{"message_ids": [20]}]))
        store.add(stored_execution(id=3, action_results=[{"message_ids": [30]}]))
        store.add(stored_execution(id=4, action_results=[{"type": "create_task"}]))
        store.messages.update({20: (2, "pending"), 30: (3, "read")})
        return store

    @staticmethod
    async def _source(message_ids):
        actual = {10: "read", 20: "failed", 30: "read"}  # el 11 ya no existe
        return {message_id: actual[message_id] for message_id in message_ids if message_id in actual}

    async def test_a_dry_run_reports_and_writes_nothing(self, world):
        from app.modules.automations.application.delivery import reconcile_delivery

        before = dict(world.messages)

        report = await reconcile_delivery(apply=False, executions=world, source=self._source, batch=2)

        assert (report.executions, report.with_messages, report.changed_executions) == (4, 3, 2)
        assert dict(report.corrected) == {"sin anotar → read": 1, "pending → failed": 1}
        assert report.untraceable == 1
        assert world.messages == before

    async def test_applying_fills_the_old_ones_and_repairs_the_lost_notice(self, world):
        from app.modules.automations.application.delivery import reconcile_delivery

        await reconcile_delivery(apply=True, executions=world, source=self._source, batch=2)

        assert world.messages == {10: (1, "read"), 20: (2, "failed"), 30: (3, "read")}
        # Reconciliar dos veces no cambia nada: ya coincide.
        again = await reconcile_delivery(apply=True, executions=world, source=self._source)
        assert not again.corrected


async def test_the_script_wires_the_app_before_reconciling(monkeypatch, capsys):
    """La primera corrida en producción murió con «los puertos no están
    configurados»: un script no pasa por el arranque de la API."""
    from types import SimpleNamespace

    from app.modules.automations.application.delivery import ReconcileReport
    from scripts import reconcile_delivery as script

    order: list[str] = []

    async def context_for(hostname):
        return SimpleNamespace(organization_id="o", schema_name="tenant_x", hostname=hostname)

    async def reconcile(*, apply):
        order.append(f"reconcile apply={apply}")
        return ReconcileReport(executions=3, with_messages=1)

    async def close():
        order.append("close")

    monkeypatch.setattr(script, "configure", lambda: order.append("configure"))
    monkeypatch.setattr(script, "_context_for", context_for)
    monkeypatch.setattr(script, "reconcile_delivery", reconcile)
    monkeypatch.setattr(script, "close_engine", close)
    monkeypatch.setattr(script, "tenant_context", lambda context: __import__("contextlib").nullcontext())
    monkeypatch.setattr("sys.argv", ["reconcile_delivery", "--hostname", "clinica.test"])

    assert await script._main() == 0

    assert order == ["configure", "reconcile apply=False", "close"]
    assert "nada que corregir" in capsys.readouterr().out


class TestDailyCap:
    """Varias automatizaciones sobre el mismo cliente podían sumar una ráfaga
    de mensajes que ninguna mandaba por separado."""

    @staticmethod
    def _deps(deps, executions, *, cap, already):
        async def enqueue(chat_id, items):
            return [{"id": 800 + index, **item} for index, item in enumerate(items)]

        async def daily_cap():
            return cap

        executions.queued_for_lead["chat-1"] = already
        return dataclasses.replace(deps, enqueue_messages=enqueue, daily_message_cap=daily_cap)

    async def test_at_the_cap_nothing_else_is_queued_and_the_step_says_why(self, deps, executions):
        from app.modules.automations.domain.errors import StepFailed

        wrapped = with_outbox_dedupe(self._deps(deps, executions, cap=3, already=3), execution_id=5, position=1)

        with pytest.raises(StepFailed, match="máximo de mensajes automáticos de hoy \\(3\\)"):
            await wrapped.enqueue_messages("chat-1", [{"message": {}}])
        assert executions.messages == {}

    async def test_below_the_cap_or_without_one_messages_go_out(self, deps, executions):
        below = with_outbox_dedupe(self._deps(deps, executions, cap=3, already=2), execution_id=5, position=1)
        assert len(await below.enqueue_messages("chat-1", [{"message": {}}])) == 1

        no_cap = with_outbox_dedupe(self._deps(deps, executions, cap=None, already=500), execution_id=6, position=1)
        assert len(await no_cap.enqueue_messages("chat-1", [{"message": {}}])) == 1

    async def test_retrying_a_step_does_not_count_its_own_messages_against_it(self, deps, executions):
        # Los tres mensajes del tope son de esta misma ejecución: reintentar
        # un paso devuelve el mismo mensaje, no manda otro.
        executions.messages.update({1: (5, "sent"), 2: (5, "sent"), 3: (5, "failed")})
        wrapped = with_outbox_dedupe(self._deps(deps, executions, cap=3, already=3), execution_id=5, position=1)

        assert len(await wrapped.enqueue_messages("chat-1", [{"message": {}}])) == 1


class TestDailyCapSetting:
    @pytest.mark.parametrize(("stored", "expected"), [("", None), ("  ", None), ("0", None), ("abc", None), ("5", 5), (" 12 ", 12)])
    async def test_reads_the_cap_or_none(self, monkeypatch, stored, expected):
        from unittest.mock import AsyncMock

        from app.modules.automations.application import deps as deps_module

        monkeypatch.setattr(deps_module, "get_effective", AsyncMock(return_value=stored))

        assert await deps_module.daily_message_cap() == expected
