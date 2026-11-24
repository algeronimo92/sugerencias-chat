"""Qué pasó con los mensajes que mandó una ejecución.

Una ejecución queda «completada» cuando encola sus mensajes, no cuando
llegan. En DermicaPro había 22 completadas con mensajes que nunca salieron y
nada las distinguía de las demás. Este módulo lleva la cuenta de la entrega
aparte del estado del motor, que sigue significando «recorrió sus pasos»:
de él dependen el tope por hora y el «no repetir para el mismo lead».

Los estados de un mensaje solo avanzan. Meta reintenta sus acuses y los manda
fuera de orden: un «entregado» tardío no puede pisar un «leído», y «fallido»
es terminal (mismo criterio que ``conversations.domain.delivery``).
"""

from __future__ import annotations

from collections.abc import Iterable
from enum import StrEnum


class MessageDeliveryState(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    READ = "read"
    FAILED = "failed"


class ExecutionDeliveryState(StrEnum):
    """El resumen de una ejecución. Sin mensajes no hay resumen (None)."""

    PENDING = "pending"
    DELIVERED = "delivered"
    FAILED = "failed"


_RANK = {
    MessageDeliveryState.PENDING: 0,
    MessageDeliveryState.SENT: 1,
    MessageDeliveryState.DELIVERED: 2,
    MessageDeliveryState.READ: 3,
    MessageDeliveryState.FAILED: 4,
}


def is_delivery_state(value: object) -> bool:
    return value in _RANK


def advance(current: str, incoming: str) -> str:
    """El estado que queda después de recibir ``incoming``: nunca retrocede.

    Un valor que no se conoce se ignora en vez de romper: Meta agrega estados
    y un acuse nuevo no debe tumbar la proyección."""
    if incoming not in _RANK:
        return current
    if current not in _RANK:
        return incoming
    return incoming if _RANK[incoming] > _RANK[current] else current


def summarize(states: Iterable[str]) -> ExecutionDeliveryState | None:
    """Del peor al mejor: con uno fallido la ejecución no se entregó; con uno
    en cola todavía está enviando; si no, salieron todos. «Leído» no cuenta
    aparte: el cliente puede tener apagada la confirmación de lectura, así que
    su ausencia no dice nada."""
    seen = list(states)
    if not seen:
        return None
    if MessageDeliveryState.FAILED in seen:
        return ExecutionDeliveryState.FAILED
    if MessageDeliveryState.PENDING in seen:
        return ExecutionDeliveryState.PENDING
    return ExecutionDeliveryState.DELIVERED


def message_ids_in(action_results: object) -> list[int]:
    """Los ids de mensaje que los pasos de una ejecución dejaron anotados en
    su resultado (``message_ids``). Es de donde se reconstruye la entrega de
    las ejecuciones anteriores a que se llevara la cuenta."""
    found: list[int] = []
    for result in action_results if isinstance(action_results, list) else []:
        ids = result.get("message_ids") if isinstance(result, dict) else None
        for message_id in ids if isinstance(ids, list) else []:
            if isinstance(message_id, int) and not isinstance(message_id, bool) and message_id not in found:
                found.append(message_id)
    return found

