"""El envío a Meta, detrás de un puerto: el worker no importa el cliente de la
Graph API (``META_ALLOWED`` en ``test_layering`` no crece). La implementación
la conecta ``app.composition``."""

from __future__ import annotations

from typing import Protocol


class ConversionSendError(Exception):
    """Rechazo de Meta traducido a lo que el worker necesita para decidir."""

    def __init__(self, message: str, *, status_code: int | None = None,
                 code: int | None = None, subcode: int | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.subcode = subcode


class ConversionSender(Protocol):
    async def is_configured(self) -> bool:
        """Si el negocio tiene WhatsApp conectado (token, número y WABA)."""

    async def waba_id(self) -> str: ...

    async def ensure_dataset(self) -> str:
        """El dataset de la WABA; Meta lo crea si no existe."""

    async def send(self, dataset_id: str, events: list[dict], test_event_code: str | None) -> dict:
        """Manda un lote. Devuelve la respuesta de Meta (``events_received``,
        ``fbtrace_id``) o levanta ``ConversionSendError``."""


_sender: ConversionSender | None = None


def provide_conversion_sender(sender: ConversionSender) -> None:
    global _sender
    _sender = sender


def conversion_sender() -> ConversionSender:
    if _sender is None:
        raise RuntimeError("No hay un ConversionSender configurado (ver app.composition)")
    return _sender
