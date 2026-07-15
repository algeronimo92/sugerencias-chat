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
    vendedor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Columna histórica conservada temporalmente para integraciones antiguas.
    # La fuente de verdad dentro del CRM es vendedor_id.
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

    __table_args__ = (Index("idx_leads_vendedor_id", vendedor_id),)


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


class LeadNote(Base):
    __tablename__ = "lead_notes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lead_id: Mapped[str] = mapped_column(ForeignKey("leads.remote_jid", ondelete="CASCADE"))
    author_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("idx_lead_notes_lead_created", lead_id, created_at, id),)


class LeadNoteMention(Base):
    __tablename__ = "lead_note_mentions"

    note_id: Mapped[int] = mapped_column(
        ForeignKey("lead_notes.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("idx_lead_note_mentions_user", user_id, created_at.desc()),)


class UserNotification(Base):
    __tablename__ = "user_notifications"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    notification_type: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    lead_id: Mapped[str | None] = mapped_column(ForeignKey("leads.remote_jid", ondelete="SET NULL"))
    source_id: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_user_notifications_user_created", user_id, created_at.desc()),
        Index("idx_user_notifications_user_read", user_id, read_at),
        Index("idx_user_notifications_lead", lead_id),
    )


class LeadTask(Base):
    __tablename__ = "lead_tasks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lead_id: Mapped[str] = mapped_column(ForeignKey("leads.remote_jid", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    task_type: Mapped[str] = mapped_column(Text, default="seguimiento")
    status: Mapped[str] = mapped_column(Text, default="pending")
    priority: Mapped[str] = mapped_column(Text, default="normal")
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    remind_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    assigned_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_lead_tasks_assignee_status_due", assigned_user_id, status, due_at),
        Index("idx_lead_tasks_lead_status_due", lead_id, status, due_at),
    )


class MessageTemplate(Base):
    __tablename__ = "message_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    shortcut: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(Text, default="general")
    stage: Mapped[str | None] = mapped_column(Text)
    task_type: Mapped[str | None] = mapped_column(Text)
    service: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    visibility: Mapped[str] = mapped_column(Text, default="global", server_default="global")
    template_type: Mapped[str] = mapped_column(Text, default="internal", server_default="internal")
    official_name: Mapped[str | None] = mapped_column(Text)
    official_language: Mapped[str | None] = mapped_column(Text)
    official_category: Mapped[str | None] = mapped_column(Text)
    official_status: Mapped[str | None] = mapped_column(Text)
    official_parameter_values: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    interactive_type: Mapped[str] = mapped_column(Text, default="none", server_default="none")
    interactive_config: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_message_templates_active_category", is_active, category),
        Index("idx_message_templates_type_status", template_type, official_status, is_active),
        Index("idx_message_templates_interactive_type", interactive_type, is_active),
        Index(
            "uq_templates_global_shortcut_lower",
            func.lower(shortcut),
            unique=True,
            postgresql_where=(visibility == "global") & shortcut.is_not(None),
        ),
        Index(
            "uq_templates_personal_shortcut_owner",
            created_by_user_id,
            func.lower(shortcut),
            unique=True,
            postgresql_where=(visibility == "personal") & shortcut.is_not(None),
        ),
    )


class TemplateUserState(Base):
    __tablename__ = "template_user_state"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("message_templates.id", ondelete="CASCADE"), primary_key=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    use_count: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (Index("idx_template_user_state_recent", user_id, last_used_at.desc()),)


class MediaAsset(Base):
    __tablename__ = "media_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    media_url: Mapped[str] = mapped_column(Text, unique=True)
    content_type: Mapped[str] = mapped_column(Text)
    filename: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    uploaded_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_media_assets_created_at", created_at.desc()),
        Index("idx_media_assets_content_type", content_type),
    )


class TemplateAttachment(Base):
    __tablename__ = "template_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("message_templates.id", ondelete="CASCADE"))
    media_url: Mapped[str] = mapped_column(Text)
    content_type: Mapped[str] = mapped_column(Text)
    filename: Mapped[str] = mapped_column(Text)
    library_asset_id: Mapped[int | None] = mapped_column(ForeignKey("media_assets.id", ondelete="RESTRICT"))
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("idx_template_attachments_template_position", template_id, position),)


class AutomationRule(Base):
    __tablename__ = "automation_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text)
    trigger_type: Mapped[str] = mapped_column(Text)
    trigger_config: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    conditions: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    actions: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    builder_mode: Mapped[str] = mapped_column(Text, default="simple", server_default="simple")
    flow_definition: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    published_flow_definition: Mapped[dict | None] = mapped_column(JSONB)
    flow_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    delay_minutes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_automation_rules_trigger_active", trigger_type, is_active),
        Index("idx_automation_rules_builder_mode", builder_mode, is_active),
    )


class AutomationExecution(Base):
    __tablename__ = "automation_executions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    rule_id: Mapped[int] = mapped_column(ForeignKey("automation_rules.id", ondelete="CASCADE"))
    lead_id: Mapped[str | None] = mapped_column(ForeignKey("leads.remote_jid", ondelete="SET NULL"))
    trigger_type: Mapped[str] = mapped_column(Text)
    event_key: Mapped[str] = mapped_column(Text)
    event_payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    status: Mapped[str] = mapped_column(Text, default="scheduled", server_default="scheduled")
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    action_results: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    flow_state: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("uq_automation_execution_rule_event", rule_id, event_key, unique=True),
        Index("idx_automation_executions_due", status, scheduled_for),
        Index("idx_automation_executions_rule_created", rule_id, created_at.desc()),
        Index("idx_automation_executions_lead_created", lead_id, created_at.desc()),
    )
