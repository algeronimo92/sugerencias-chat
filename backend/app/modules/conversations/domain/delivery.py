"""Ciclo de entrega de un mensaje saliente por el outbox.

Un envío falla de tres maneras distintas, y cada una decide si se reintenta:
un error transitorio del canal se reintenta con espera creciente, un rechazo
definitivo no, y un envío cuya entrega no se pudo confirmar tampoco (reenviarlo
podría duplicarlo en el teléfono del cliente).
"""

from __future__ import annotations

from datetime import timedelta
from enum import StrEnum

from app.modules.conversations.domain.types import MessageOutboxStatus, OutboxStatus

MAX_ATTEMPTS = 3


class SendOutcome(StrEnum):
    RETRYABLE = "retryable"
    DEFINITIVE = "definitive"
    UNCONFIRMED = "unconfirmed"


def is_final_failure(attempts: int, outcome: SendOutcome) -> bool:
    return outcome is not SendOutcome.RETRYABLE or attempts >= MAX_ATTEMPTS


def retry_delay(attempts: int) -> timedelta:
    """Espera exponencial antes del próximo intento: 2, 4, 8 segundos."""
    return timedelta(seconds=2 ** attempts)


def statuses_after_failure(exhausted: bool) -> tuple[OutboxStatus, MessageOutboxStatus]:
    """Estado del trabajo y del mensaje tras un fallo."""
    if exhausted:
        return OutboxStatus.FAILED, MessageOutboxStatus.FAILED
    return OutboxStatus.PENDING, MessageOutboxStatus.RETRYABLE_FAILED


# Orden de avance de lo que Meta informa de un envío. ``failed`` es terminal:
# ningún acuse tardío lo pisa. Un estado que no está acá se guarda como evento
# pero no mueve la proyección hasta que el contrato lo conozca.
META_STATUS_RANK = {"sent": 1, "delivered": 2, "read": 3, "failed": 4}


def strongest_meta_status(statuses: list[tuple[str, dict]]) -> tuple[str, dict] | None:
    """El estado más avanzado entre los eventos recibidos, sin importar en qué
    orden llegaron (Meta los reintenta y los manda fuera de orden)."""
    ranked = [
        (META_STATUS_RANK[value], value, payload)
        for value, payload in statuses
        if value in META_STATUS_RANK
    ]
    if not ranked:
        return None
    _rank, value, payload = max(ranked, key=lambda item: item[0])
    return value, payload
