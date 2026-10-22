"""Quién manda un mensaje y los estados de la cola de envío y de los programados."""

from enum import StrEnum


class MessageSender(StrEnum):
    """Quién envió el mensaje en wsp_messages.sender."""

    CUSTOMER = "cliente"
    SELLER = "vendedor"


class MessageDirection(StrEnum):
    """``wsp_messages.direction``: la calcula la base desde ``sender``."""

    INBOUND = "inbound"
    OUTBOUND = "outbound"


class MessageOutboxStatus(StrEnum):
    """Estado interno de un envío en ``wsp_messages.outbox_status``.

    Describe nuestra cola, no WhatsApp: lo que pasó del lado de Meta vive en
    ``meta_status`` con el valor literal que informa Meta.
    """

    QUEUED = "queued"
    SENDING = "sending"
    SENT = "sent"
    # Falló un intento y queda otro programado.
    RETRYABLE_FAILED = "retryable_failed"
    # Agotó los intentos o el error no admite reintento automático.
    FAILED = "failed"
    # Un fallo que alguien revisó y decidió no reenviar.
    DISCARDED = "discarded"


class OutboxStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    SENT = "sent"
    FAILED = "failed"
    DISCARDED = "discarded"


class ScheduledMessageStatus(StrEnum):
    SCHEDULED = "scheduled"
    PROCESSING = "processing"
    QUEUED = "queued"
    SENT = "sent"
    FAILED = "failed"
    CANCELLED = "cancelled"
