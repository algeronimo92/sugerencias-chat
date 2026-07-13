from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, Text, func
from sqlalchemy.dialects.postgresql import ENUM, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class LeadStage(str, Enum):
    nuevo = "nuevo"
    calificacion = "calificacion"
    cotizacion = "cotizacion"
    objecion = "objecion"
    cierre = "cierre"
    agendado = "agendado"
    postventa = "postventa"
    sin_respuesta = "sin_respuesta"
    reactivacion = "reactivacion"
    perdido = "perdido"


class Lead(Base):
    __tablename__ = "leads"

    remote_jid: Mapped[str] = mapped_column(Text, primary_key=True)
    telefono: Mapped[str | None] = mapped_column(Text)
    nombre: Mapped[str | None] = mapped_column(Text)
    servicio_interes: Mapped[str | None] = mapped_column(Text)
    vendedor: Mapped[str | None] = mapped_column(Text)
    origen: Mapped[str | None] = mapped_column(Text)
    notas: Mapped[str | None] = mapped_column(Text)
    # El enum lead_estado ya existe en la base compartida. create_type=False
    # evita que SQLAlchemy intente recrearlo al iniciar la aplicación.
    estado: Mapped[LeadStage] = mapped_column(
        ENUM(LeadStage, name="lead_estado", create_type=False),
        default=LeadStage.nuevo,
        server_default=LeadStage.nuevo.value,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Último momento en que se abrió el chat en el panel — se compara contra
    # wsp_messages.sent_at de los mensajes del cliente para saber cuántos
    # quedaron sin ver (ver services/db_service.py:_unread_count_subquery).
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Última respuesta de n8n para este lead (SuggestionResponse serializado)
    # y cuándo se generó. Se sirve directo mientras no llegue un mensaje
    # nuevo del cliente después de cached_suggestion_at — ver
    # services/db_service.py:get_cached_suggestion.
    cached_suggestion: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    cached_suggestion_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WspMessage(Base):
    __tablename__ = "wsp_messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    chat_id: Mapped[str] = mapped_column(Text)
    sender: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    media_url: Mapped[str | None] = mapped_column(Text)
    # ID del mensaje en WhatsApp (key.id de Evolution API) — permite matchear
    # los eventos de cambio de estado (entregado/leído) contra esta fila.
    wa_message_id: Mapped[str | None] = mapped_column(Text)
    # SERVER_ACK / DELIVERY_ACK / READ / PLAYED, tal cual lo manda Evolution
    # API. Solo tiene sentido para mensajes del vendedor (sender="vendedor").
    status: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index(
            "idx_wsp_messages_chat_cursor",
            chat_id,
            sent_at.desc(),
            id.desc(),
        ),
    )


class AppSetting(Base):
    """Configuración editable desde la app (API keys de servicios externos:
    n8n, Evolution API, ElevenLabs, y los que se vayan sumando). Los valores acá
    tienen prioridad sobre las variables de entorno homónimas — ver
    services/settings_service.py."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text)  # "admin" | "vendedor"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class LeadTag(Base):
    """Catálogo administrable de etiquetas comerciales."""

    __tablename__ = "lead_tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    color: Mapped[str] = mapped_column(Text, default="#16a34a")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("uq_lead_tags_name_lower", func.lower(name), unique=True),
        Index("idx_lead_tags_created_by", created_by),
    )


class LeadTagAssignment(Base):
    __tablename__ = "lead_tag_assignments"

    lead_id: Mapped[str] = mapped_column(
        ForeignKey("leads.remote_jid", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        ForeignKey("lead_tags.id", ondelete="CASCADE"), primary_key=True
    )
    assigned_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_lead_tag_assignments_tag_lead", tag_id, lead_id),
        Index("idx_lead_tag_assignments_assigned_by", assigned_by),
    )


class LeadActivity(Base):
    """Auditoría append-only de cambios comerciales del lead."""

    __tablename__ = "lead_activity"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lead_id: Mapped[str] = mapped_column(ForeignKey("leads.remote_jid", ondelete="CASCADE"))
    event_type: Mapped[str] = mapped_column(Text)
    actor_type: Mapped[str] = mapped_column(Text)  # user | agent | n8n | system
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    old_value: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    new_value: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_lead_activity_lead_created", lead_id, created_at.desc()),
        Index("idx_lead_activity_actor_user", actor_user_id),
    )
