"""Reconciliación de la entrega: deja la proyección igual a la fuente.

La entrega de cada ejecución se lleva con los avisos de envío
(``subscribers.note_message_*``). Un aviso se puede perder —un reinicio entre
el commit del envío y el suscriptor— y las ejecuciones anteriores a que se
llevara la cuenta no tienen nada anotado. Este caso de uso recorre las
ejecuciones, le pregunta a conversaciones en qué quedó cada mensaje y corrige
lo que no coincida.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.modules.automations.application.ports import ExecutionStore, automation_ports
from app.modules.conversations.ports.message_delivery import delivery_states

BATCH = 500


@dataclass
class ReconcileReport:
    executions: int = 0
    with_messages: int = 0
    # Mensajes que la proyección no tenía o tenía en otro estado.
    corrected: Counter = field(default_factory=Counter)
    # Mensajes anotados en un paso que conversaciones ya no puede ubicar.
    untraceable: int = 0
    changed_executions: int = 0


async def reconcile_delivery(
    *,
    apply: bool,
    executions: ExecutionStore | None = None,
    source: Callable[[list[int]], Awaitable[dict[int, str]]] = delivery_states,
    batch: int = BATCH,
) -> ReconcileReport:
    """Compara y, con ``apply``, corrige. Sin ``apply`` solo cuenta."""
    store = executions or automation_ports().executions
    report = ReconcileReport()
    after_id = 0
    while True:
        page = await store.queued_message_ids(after_id, batch)
        if not page:
            return report
        after_id = page[-1][0]
        report.executions += len(page)
        with_messages = [(execution_id, ids) for execution_id, ids in page if ids]
        report.with_messages += len(with_messages)
        actual = await source([message_id for _, ids in with_messages for message_id in ids])
        tracked = await store.tracked_message_states([execution_id for execution_id, _ in with_messages])
        for execution_id, ids in with_messages:
            wanted = {message_id: actual[message_id] for message_id in ids if message_id in actual}
            report.untraceable += len(ids) - len(wanted)
            known = tracked.get(execution_id, {})
            changes = {message_id: state for message_id, state in wanted.items() if known.get(message_id) != state}
            if not changes:
                continue
            report.changed_executions += 1
            for message_id, state in changes.items():
                report.corrected[f"{known.get(message_id, 'sin anotar')} → {state}"] += 1
            if apply:
                await store.replace_message_states(execution_id, changes, datetime.now(timezone.utc))
