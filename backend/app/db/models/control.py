"""Modelos ORM del dominio control."""

from datetime import datetime
from typing import Any
from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, LargeBinary, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class Organization(Base):
    """Negocio registrado en el plano de control compartido."""

    __tablename__ = "organizations"
    __table_args__ = (
        CheckConstraint(
            "status IN ('provisioning', 'active', 'suspended', 'failed', 'deleting')",
            name="organizations_status_check",
        ),
        CheckConstraint(
            "schema_name ~ '^tenant_[0-9a-f]{32}$'",
            name="organizations_schema_name_check",
        ),
        CheckConstraint(
            "ai_monthly_quota IS NULL OR ai_monthly_quota >= 0",
            name="organizations_ai_monthly_quota_check",
        ),
        {"schema": "public"},
    )

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="provisioning", server_default="provisioning"
    )
    schema_name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # Carpeta del negocio en el almacenamiento de objetos: "<uuid>-<nombre>".
    # Se calcula al aprovisionar y no se vuelve a tocar -- el nombre está solo
    # para reconocerlo en la consola de MinIO, y recalcularlo al renombrar el
    # negocio dejaría huérfanos todos sus archivos anteriores.
    storage_prefix: Mapped[str | None] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Asistente IA (sugerencias y analista): lo habilita la plataforma según el
    # plan del negocio. La cuota cuenta generaciones por mes calendario UTC;
    # NULL significa sin tope.
    ai_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    ai_monthly_quota: Mapped[int | None] = mapped_column(Integer)


class OrganizationBranding(Base):
    """Marca con la que cada negocio ve su CRM: nombre, color y logo.

    Vive en el plano de control porque se necesita antes del login (pantalla
    de acceso, manifest de la PWA), cuando todavía no hay sesión del negocio.
    Los PNG ya vienen normalizados por app/modules/platform/branding.py: cuadrados, sin
    metadatos y en los dos tamaños que pide una PWA. Tabla aparte para no
    cargar los binarios cada vez que se lista ``organizations``.
    """

    __tablename__ = "organization_branding"
    __table_args__ = (
        CheckConstraint(
            "primary_color IS NULL OR primary_color ~ '^#[0-9a-f]{6}$'",
            name="organization_branding_color_check",
        ),
        {"schema": "public"},
    )

    organization_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False),
        ForeignKey("public.organizations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    display_name: Mapped[str | None] = mapped_column(Text)
    primary_color: Mapped[str | None] = mapped_column(Text)
    logo_png: Mapped[bytes | None] = mapped_column(LargeBinary)
    icon_png: Mapped[bytes | None] = mapped_column(LargeBinary)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class OrganizationDomain(Base):
    __tablename__ = "organization_domains"
    __table_args__ = (
        CheckConstraint("hostname = lower(hostname)", name="organization_domains_lower_check"),
        Index(
            "uq_organization_domains_primary",
            "organization_id",
            unique=True,
            postgresql_where=text("is_primary"),
        ),
        {"schema": "public"},
    )

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    organization_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False),
        ForeignKey("public.organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    hostname: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    is_primary: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class WhatsAppConnection(Base):
    """Conexión que permite resolver un webhook antes de conocer el tenant."""

    __tablename__ = "whatsapp_connections"
    __table_args__ = (
        CheckConstraint(
            "status IN ('provisioning', 'active', 'disabled', 'failed')",
            name="whatsapp_connections_status_check",
        ),
        Index("idx_whatsapp_connections_organization", "organization_id"),
        {"schema": "public"},
    )

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    organization_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False),
        ForeignKey("public.organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    phone_number_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    waba_id: Mapped[str | None] = mapped_column(Text)
    encrypted_credentials: Mapped[str | None] = mapped_column(Text)
    secret_reference: Mapped[str | None] = mapped_column(Text)
    credential_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="provisioning", server_default="provisioning"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class TenantSchemaVersion(Base):
    __tablename__ = "tenant_schema_versions"
    __table_args__ = (
        CheckConstraint(
            "migration_status IN ('pending', 'running', 'current', 'failed')",
            name="tenant_schema_versions_status_check",
        ),
        {"schema": "public"},
    )

    organization_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False),
        ForeignKey("public.organizations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    revision: Mapped[str | None] = mapped_column(Text)
    migration_status: Mapped[str] = mapped_column(
        Text, nullable=False, default="pending", server_default="pending"
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class PlatformSetting(Base):
    """Credencial o configuración verdaderamente global de la plataforma —no
    de un negocio—, como la app de Meta compartida (Tech Provider) que todos
    los tenants usan para el Embedded Signup, la clave de cifrado o valores de
    infraestructura. Distinta de `app_settings`, que vive dentro de cada
    schema tenant y es por-negocio (ver app/modules/platform/settings_service.py).

    El valor siempre viaja cifrado (a diferencia de `app_settings.value`, que
    solo cifra las keys marcadas `secret=True`): acá no hay configuración en
    claro, por eso la columna se llama `encrypted_value` y no `value`. La
    administra exclusivamente el panel de plataforma; los tenants solo reciben
    los valores públicos necesarios para iniciar Embedded Signup.
    """

    __tablename__ = "platform_settings"
    __table_args__ = ({"schema": "public"},)

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    encrypted_value: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class PlatformUser(Base):
    """Operador de la plataforma: da de alta y administra negocios.

    Vive en `public` y **no** es un usuario de ningún CRM. Los `users` de un
    negocio están dentro de su schema y su rol `admin` solo manda ahí: que el
    operador tuviera identidad de negocio convertiría cualquier CRM comprometido
    en una vía de entrada al panel de todos los demás (ver
    docs/multi-tenant-saas-plan.md sección 5.2).
    """

    __tablename__ = "platform_users"
    __table_args__ = ({"schema": "public"},)

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PlatformSession(Base):
    """Sesión del panel de plataforma, separada de `auth_sessions`.

    Deliberadamente más simple que la del CRM: sin dispositivos de confianza,
    sin PIN y sin rotación de token. Son pocas sesiones, de vida corta y de
    gente con permisos amplios; cuanto menos superficie, mejor.
    """

    __tablename__ = "platform_sessions"
    __table_args__ = (
        Index("idx_platform_sessions_user", "platform_user_id"),
        {"schema": "public"},
    )

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    platform_user_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False),
        ForeignKey("public.platform_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WebhookInbox(Base):
    """Evento durable previo al ACK del proveedor.

    El payload vive temporalmente en public porque aún no se conoce el schema al
    recibirlo. Solo el rol de integración debe leerlo y una política operativa
    debe eliminar payloads procesados después de una retención corta.
    """

    __tablename__ = "webhook_inbox"
    __table_args__ = (
        CheckConstraint(
            "status IN ('received', 'processing', 'processed', 'failed')",
            name="webhook_inbox_status_check",
        ),
        Index("uq_webhook_inbox_provider_event", "provider", "event_key", unique=True),
        Index("idx_webhook_inbox_pending", "status", "received_at"),
        {"schema": "public"},
    )

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    event_key: Mapped[str] = mapped_column(Text, nullable=False)
    connection_key: Mapped[str | None] = mapped_column(Text)
    phone_number_id: Mapped[str | None] = mapped_column(Text)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="received", server_default="received"
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
