"""Modelos ORM del dominio catalogs."""

from datetime import datetime
from decimal import Decimal
from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


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


class LeadService(Base):
    """Catálogo compartido de servicios que pueden interesarle a un lead.

    ``Lead.servicio_interes`` continúa siendo texto por compatibilidad con n8n
    y las integraciones existentes. El catálogo elimina el texto libre en la
    interfaz sin exigir una migración coordinada de esos consumidores.
    """

    __tablename__ = "lead_services"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Lo que el asistente IA consulta como catálogo: qué es el servicio y
    # cuánto cuesta. La moneda es la del perfil del negocio (AIProfile).
    description: Mapped[str | None] = mapped_column(Text)
    price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    price_notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("price IS NULL OR price >= 0", name="lead_services_price_check"),
        Index("uq_lead_services_name_lower", func.lower(name), unique=True),
        Index("idx_lead_services_created_by", created_by),
    )


class TemplateCategory(Base):
    """Categorías consistentes para las plantillas compartidas del CRM."""

    __tablename__ = "template_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("uq_template_categories_name_lower", func.lower(name), unique=True),
        Index("idx_template_categories_created_by", created_by),
    )


class CustomFieldDefinition(Base):
    """Campo que un negocio decide mostrar en leads o citas."""

    __tablename__ = "custom_field_definitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(Text)
    key: Mapped[str] = mapped_column(Text)
    label: Mapped[str] = mapped_column(Text)
    field_type: Mapped[str] = mapped_column(Text)
    required: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    options: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("entity_type IN ('lead', 'appointment')", name="custom_fields_entity_check"),
        CheckConstraint(
            "field_type IN ('text', 'textarea', 'number', 'date', 'datetime', 'boolean', 'select')",
            name="custom_fields_type_check",
        ),
        Index("uq_custom_fields_entity_key", entity_type, key, unique=True),
        Index("idx_custom_fields_entity_position", entity_type, position, id),
    )


class MessageTemplate(Base):
    __tablename__ = "message_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    shortcut: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(
        Text,
        ForeignKey("template_categories.name", onupdate="CASCADE", ondelete="RESTRICT"),
        default="General",
    )
    stage: Mapped[str | None] = mapped_column(Text)
    task_type: Mapped[str | None] = mapped_column(Text)
    service: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("lead_services.name", onupdate="CASCADE", ondelete="RESTRICT"),
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    visibility: Mapped[str] = mapped_column(Text, default="global", server_default="global")
    template_type: Mapped[str] = mapped_column(Text, default="internal", server_default="internal")
    official_name: Mapped[str | None] = mapped_column(Text)
    official_language: Mapped[str | None] = mapped_column(Text)
    official_category: Mapped[str | None] = mapped_column(Text)
    official_status: Mapped[str | None] = mapped_column(Text)
    official_rejected_reason: Mapped[str | None] = mapped_column(Text)
    official_parameter_values: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    meta_template_id: Mapped[str | None] = mapped_column(Text)
    official_header_type: Mapped[str] = mapped_column(Text, default="none", server_default="none")
    official_header_text: Mapped[str | None] = mapped_column(Text)
    official_header_media_asset_id: Mapped[int | None] = mapped_column(ForeignKey("media_assets.id", ondelete="SET NULL"))
    official_footer: Mapped[str | None] = mapped_column(Text)
    official_buttons: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    interactive_type: Mapped[str] = mapped_column(Text, default="none", server_default="none")
    interactive_config: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    imported_from_meta: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
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

    __table_args__ = (
        Index("idx_template_user_state_recent", user_id, last_used_at.desc()),
        Index("idx_template_user_state_template", template_id),
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

    __table_args__ = (
        Index("idx_template_attachments_template_position", template_id, position),
        Index("idx_template_attachments_library_asset", library_asset_id),
    )
