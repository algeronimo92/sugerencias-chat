"""Eventos de dominio y su despacho en dos fases.

Un caso de uso no llama a los módulos que reaccionan a lo que hizo: registra
eventos en la unidad de trabajo (``app.db.uow``) y cada interesado se suscribe.
Así ``leads`` no necesita conocer a ``automations`` para que un cambio de etapa
agende flujos, ni la lógica de negocio importa el WebSocket.

Las fases responden a una sola pregunta, si el efecto tiene que ser atómico
con el cambio que lo originó:

- ``transaction``: corre dentro de la misma transacción, antes del commit.
  Si falla, el caso de uso entero se revierte. Es para lo que no puede quedar
  a medias: la auditoría, agendar automatizaciones, el outbox.
- ``after_commit``: corre solo si el commit ocurrió. Un error se registra y no
  se propaga, porque el cambio ya es definitivo. Es para avisos: WebSocket,
  push, notificaciones a terceros que no deben ver un estado revertido.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, TypeVar

logger = logging.getLogger(__name__)


@dataclass(frozen=True, kw_only=True)
class DomainEvent:
    """Algo que ya pasó en el negocio. Inmutable y sin comportamiento."""


class Phase(StrEnum):
    TRANSACTION = "transaction"
    AFTER_COMMIT = "after_commit"


E = TypeVar("E", bound=DomainEvent)
Handler = Callable[[Any], Awaitable[None]]

_handlers: dict[tuple[type[DomainEvent], Phase], list[Handler]] = {}

# Un handler en transacción puede registrar eventos nuevos (p. ej. una
# automatización que cambia la etapa). Se despachan en la misma pasada; el
# tope corta un ciclo entre handlers en lugar de colgar la petición.
MAX_DISPATCH_ROUNDS = 20


def subscribe(event_type: type[E], *, phase: Phase) -> Callable[[Callable[[E], Awaitable[None]]], Callable[[E], Awaitable[None]]]:
    """Registra un handler. Registrar dos veces la misma función no la duplica."""

    def register(handler: Callable[[E], Awaitable[None]]) -> Callable[[E], Awaitable[None]]:
        handlers = _handlers.setdefault((event_type, phase), [])
        if handler not in handlers:
            handlers.append(handler)
        return handler

    return register


def handlers_for(event: DomainEvent, phase: Phase) -> list[Handler]:
    """Handlers del tipo exacto y de sus superclases, en orden de registro."""
    found: list[Handler] = []
    for cls in type(event).__mro__:
        if isinstance(cls, type) and issubclass(cls, DomainEvent):
            found.extend(_handlers.get((cls, phase), ()))
    return found


async def dispatch_in_transaction(pending: list[DomainEvent]) -> None:
    """Despacha la fase ``transaction``, incluidos los eventos que los propios
    handlers agreguen a ``pending`` mientras corren."""
    dispatched = 0
    rounds = 0
    while dispatched < len(pending):
        rounds += 1
        if rounds > MAX_DISPATCH_ROUNDS:
            raise RuntimeError("Los handlers de eventos se disparan en ciclo")
        batch = pending[dispatched:]
        dispatched = len(pending)
        for event in batch:
            for handler in handlers_for(event, Phase.TRANSACTION):
                await handler(event)


async def dispatch_after_commit(events: Iterable[DomainEvent]) -> None:
    for event in events:
        for handler in handlers_for(event, Phase.AFTER_COMMIT):
            try:
                await handler(event)
            except Exception:
                logger.exception(
                    "Falló un handler posterior al commit: %s para %s",
                    getattr(handler, "__qualname__", handler), type(event).__name__,
                )


async def publish(*events: DomainEvent, strict: bool = False) -> None:
    """Para adaptadores que avisan algo sin abrir una transacción (p. ej. un
    worker que detecta mensajes insertados por fuera): despacha ya la fase
    ``after_commit``. Dentro de un caso de uso se usa ``app.db.uow.collect``.

    Con ``strict`` un handler que falla corta y propaga el error, para que el
    adaptador pueda reintentar (el vigilante no avanza su cursor)."""
    if not strict:
        await dispatch_after_commit(events)
        return
    for event in events:
        for handler in handlers_for(event, Phase.AFTER_COMMIT):
            await handler(event)


def clear_handlers() -> None:
    """Solo para tests que registran handlers propios."""
    _handlers.clear()
