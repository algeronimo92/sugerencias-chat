"""Modelos ORM del dominio conversations."""

from datetime import datetime
from typing import Any
from sqlalchemy import BigInteger, CheckConstraint, Computed, DateTime, ForeignKey, Identity, Index, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class WspMessage(Base):
    __tablename__ = "wsp_messages"
    # ``direction`` la calcula la base: sin esto SQLAlchemy la invalida en
    # cada UPDATE y serializar la fila después del commit dispara una carga
    # perezosa fuera del contexto async.
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    chat_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="CASCADE")
    )
    sender: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    media_url: Mapped[str | None] = mapped_column(Text)
    # ``messages[].id`` literal de Meta (``wamid...``). Es la clave que
    # comparten los estados, las reacciones y las citas.
    wa_message_id: Mapped[str | None] = mapped_column(Text)
    # Dimensiones de la imagen adjunta, calculadas de forma perezosa al servir
    # el chat: el frontend reserva el espacio exacto antes de que cargue.
    # 0/0 significa "no se pudo medir, no reintentar"; NULL, "todavía no".
    media_width: Mapped[int | None] = mapped_column(Integer)
    media_height: Mapped[int | None] = mapped_column(Integer)
    # Mensaje al que responde este (``context.id`` de Meta). Se guarda el
    # wa_message_id y no la clave primaria: la fila local se resuelve por
    # (chat_id, wa_message_id) al servir el historial.
    quoted_wa_message_id: Mapped[str | None] = mapped_column(Text)
    # ``messages[].type`` literal de Meta. Sin CHECK: la base guarda un tipo
    # que Meta agregue mañana; contracts/meta_messages.json dice cuáles tienen
    # renderer. NULL solo en filas muy antiguas.
    message_type: Mapped[str | None] = mapped_column(Text)
    # Enriquecimiento generado con IA para adjuntos (descripción de imagen/video,
    # transcripción de audio, OCR de documento). Estructura:
    # {summary, kind: "descripcion"|"transcripcion", model, generated_at, version}.
    # Va aparte de `content` para no mostrárselo al vendedor dentro de la burbuja
    # y poder regenerarlo sin pisar el caption. NULL si no hay análisis.
    # none_as_null: sin él, un None de Python se guarda como el literal JSON
    # `null` (no SQL NULL), y las consultas `IS NULL`/`->>'summary'` fallan.
    analysis: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    # Proyección del CRM para la UI: lo que el cuerpo de Meta no trae (datos
    # de la plantilla enviada, reenviado, álbum, imagen del anuncio
    # rehospedada). Lo canónico está en provider_payload.
    payload: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    # Reacciones sobre ESTE mensaje (badge estilo WhatsApp, no una fila aparte):
    # lista de {emoji, from_me}, a lo sumo una entrada por lado en un chat 1:1.
    # Es la proyección de los eventos de reacción (whatsapp_message_events).
    # NULL cuando nadie reaccionó.
    reactions: Mapped[list | None] = mapped_column(JSONB(none_as_null=True))
    # Última vez que se reescribió el texto (WhatsApp permite editar un mensaje
    # propio de texto dentro de los 15 minutos). `content` guarda el texto
    # vigente; esta marca es la que habilita el "Editado" de la burbuja.
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Eliminado para todos. Borrado lógico: la fila queda para la auditoría del
    # CRM, pero la API deja de servir contenido y adjunto (ver _mask_deleted en
    # db_service) y el hilo pinta la lápida, igual que WhatsApp.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Fijado nativo del CRM: Meta no expone forma de fijar un mensaje del
    # lado de quien envía, así que esto vive solo acá — no se replica hacia
    # WhatsApp. Hasta 3 por
    # chat, igual que el límite real de WhatsApp (se aplica en db_service).
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pinned_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Subtipo literal de Meta (``interactive.type``, ``system.type``). NULL en
    # las raíces que no tienen subtipos.
    message_subtype: Mapped[str | None] = mapped_column(Text)
    # El objeto ``messages[]`` tal como lo mandó Meta, o el cuerpo exacto que
    # el CRM le envió. Es la fuente canónica: content, media_url y payload son
    # proyecciones derivadas de esto para la UI y la búsqueda.
    provider_payload: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    # Fila de public.webhook_inbox de la que salió el mensaje. Sin FK: el
    # inbox vive en el plano de control y se purga tras su retención.
    webhook_event_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False))
    # Generada por la base desde ``sender``: nunca se contradicen.
    direction: Mapped[str] = mapped_column(
        Text,
        Computed("CASE WHEN sender = 'cliente' THEN 'inbound' ELSE 'outbound' END", persisted=True),
    )
    # Estado interno del envío (outbox) y estado literal que informa Meta, por
    # separado: uno describe nuestra cola, el otro lo que pasó en WhatsApp.
    outbox_status: Mapped[str | None] = mapped_column(Text)
    meta_status: Mapped[str | None] = mapped_column(Text)
    # Último evento de estado completo (errores, pricing, conversation).
    status_payload: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))

    __table_args__ = (
        Index(
            "idx_wsp_messages_chat_cursor",
            chat_id,
            sent_at.desc(),
            id.desc(),
        ),
        # Hasta 3 filas con pinned_at no nulo por chat; se filtra por eso al
        # armar la barra de fijados sin escanear el chat entero.
        Index(
            "idx_wsp_messages_pinned",
            chat_id,
            pinned_at,
            postgresql_where=text("pinned_at IS NOT NULL"),
        ),
        # UNIQUE, no sólo índice: Meta reenvía el mismo webhook cuando no
        # recibe confirmación, y sin la restricción el reintento inserta el
        # mensaje una segunda vez. Parcial porque los mensajes que envía el CRM
        # se guardan antes de conocer su id de WhatsApp, y varios NULL a la vez
        # son legítimos.
        #
        # Es también el índice que resuelve el mensaje citado al servir el
        # historial: al ser único, buscar por wa_message_id devuelve como mucho
        # una fila y el chat_id se comprueba sobre ella.
        Index(
            "idx_wsp_messages_wa_message_id",
            wa_message_id,
            unique=True,
            postgresql_where=text("wa_message_id IS NOT NULL"),
        ),
    )


class WhatsAppMessageEvent(Base):
    """Estado o reacción de Meta sobre un mensaje, tal como llegó.

    Es la fuente de ``wsp_messages.meta_status`` y del badge ``reactions``:
    las proyecciones se recalculan desde acá, así una entrega repetida o fuera
    de orden no deja la fila en un estado que Meta nunca informó.
    """

    __tablename__ = "whatsapp_message_events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    wa_message_id: Mapped[str] = mapped_column(Text, nullable=False)
    chat_id: Mapped[str | None] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="CASCADE")
    )
    value: Mapped[str | None] = mapped_column(Text)
    actor: Mapped[str | None] = mapped_column(Text)
    event_wa_id: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provider_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    webhook_event_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("kind IN ('status', 'reaction')", name="whatsapp_message_events_kind_check"),
        CheckConstraint(
            "actor IS NULL OR actor IN ('customer', 'business')",
            name="whatsapp_message_events_actor_check",
        ),
        Index("idx_whatsapp_message_events_target", wa_message_id, kind, occurred_at),
        Index(
            "uq_whatsapp_message_events_status",
            wa_message_id,
            value,
            occurred_at,
            unique=True,
            postgresql_where=text("kind = 'status'"),
        ),
        Index(
            "uq_whatsapp_message_events_event_wa_id",
            event_wa_id,
            unique=True,
            postgresql_where=text("event_wa_id IS NOT NULL"),
        ),
    )


class MessageOutbox(Base):
    """Trabajo durable para enviar mensajes sin bloquear el request HTTP."""

    __tablename__ = "message_outbox"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    message_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("wsp_messages.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    chat_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False),
        ForeignKey("leads.id", ondelete="CASCADE"),
        nullable=False,
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now()
    )
    last_error: Mapped[str | None] = mapped_column(Text)
    dedupe_key: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_message_outbox_pending", status, next_attempt_at, id),
        Index("idx_message_outbox_chat_order", chat_id, id),
        Index("uq_message_outbox_dedupe_key", dedupe_key, unique=True),
    )


class ScheduledMessage(Base):
    """Mensaje que se convertirá en trabajo de outbox al llegar su hora."""

    __tablename__ = "scheduled_messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lead_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False),
        ForeignKey("leads.id", ondelete="CASCADE"),
        nullable=False,
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="scheduled")
    created_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    queued_message_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("wsp_messages.id", ondelete="SET NULL"),
        unique=True,
    )
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_scheduled_messages_due", status, scheduled_at, id),
        Index("idx_scheduled_messages_lead", lead_id, scheduled_at.desc()),
        Index("idx_scheduled_messages_created_by", created_by_user_id),
    )
