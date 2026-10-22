"""El contrato de mensajes de Meta como adaptador del puerto ``MessageContract``.

Cada mensaje saliente es un cuerpo de Meta Cloud API. Validarlo contra la
allowlist y las capacidades de la cuenta es saber del proveedor: vive acá y la
aplicación solo pide ``prepare``.
"""

from __future__ import annotations

from app.integrations.meta.outbound import (
    OutboundRejected,
    message_subtype,
    reaction_message,
    require_capabilities,
    text_item,
    validate_message,
    with_context,
)
from app.integrations.meta_webhook import metrics


class MetaMessageContract:
    async def prepare(self, items: list[dict]) -> list[dict]:
        prepared = []
        for item in items:
            reply_to = item.get("reply_to")
            message = with_context(item["message"], reply_to["wa_message_id"] if reply_to else None)
            try:
                validate_message(message)
                await require_capabilities(message)
            except OutboundRejected as exc:
                metrics.outbound_rejected.labels(reason=exc.reason).inc()
                raise
            prepared.append({**item, "message": message, "message_subtype": message_subtype(message)})
        return prepared

    def subtype(self, message: dict) -> str | None:
        return message_subtype(message)

    def text(self, text: str) -> dict:
        return text_item(text)

    def reaction(self, target_wa_message_id: str, emoji: str) -> dict:
        message = reaction_message(target_wa_message_id, emoji)
        validate_message(message, final=True)
        return message
