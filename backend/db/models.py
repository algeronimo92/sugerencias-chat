from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    SmallInteger,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from domain_types import (
    INITIAL_LEAD_STAGE,
    AutomationBuilderMode,
    AutomationExecutionStatus,
    IssueReportPriority,
    IssueReportStatus,
    TaskPriority,
    TaskStatus,
    TaskType,
)


class Base(DeclarativeBase):
    pass


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
    Los PNG ya vienen normalizados por services/branding.py: cuadrados, sin
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
    schema tenant y es por-negocio (ver services/settings_service.py).

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
    __table_args__ = ({"schema": "public"},)

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


class AIJob(Base):
    """Autorización tenant-scoped para una invocación de IA/n8n.

    No declara ``schema``: se crea y consulta dentro de cada schema tenant por
    medio de ``tenant_session``. Nunca debe incorporarse al plano de control.
    """

    __tablename__ = "ai_jobs"
    __table_args__ = (
        CheckConstraint(
            "operation IN ('rag', 'analyst', 'media_analysis')",
            name="ai_jobs_operation_check",
        ),
        CheckConstraint(
            "status IN ('pending', 'running', 'succeeded', 'failed', 'expired', 'applied')",
            name="ai_jobs_status_check",
        ),
        Index("idx_ai_jobs_status_expiry", "status", "expires_at"),
        Index("idx_ai_jobs_chat_created", "chat_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    operation: Mapped[str] = mapped_column(Text, nullable=False)
    resource_id: Mapped[str] = mapped_column(Text, nullable=False)
    chat_id: Mapped[str | None] = mapped_column(Text)
    # Revisión opaca (p.ej. v1:<sha256>), distinta de conversacion_version.
    context_revision: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="pending", server_default="pending"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    request_metadata: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)


class KnowledgeDocument(Base):
    """Documento RAG aislado por el search_path del tenant."""

    __tablename__ = "knowledge_documents"

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str | None] = mapped_column(Text)
    document_type: Mapped[str | None] = mapped_column(Text)
    # Texto completo tal como lo cargó el negocio. Los chunks se derivan de acá
    # y se regeneran al editarlo; nunca se editan sueltos.
    content: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AIProfile(Base):
    """Perfil del negocio que el asistente IA recibe en cada job.

    Una sola fila por schema tenant (``id = 1``). Son datos del negocio, no
    instrucciones de sistema: el prompt base del copiloto lo mantiene la
    plataforma y estos campos entran como contexto acotado.
    """

    __tablename__ = "ai_profile"
    __table_args__ = (CheckConstraint("id = 1", name="ai_profile_singleton_check"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    business_name: Mapped[str | None] = mapped_column(Text)
    business_description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    opening_hours: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str | None] = mapped_column(Text)
    tone: Mapped[str | None] = mapped_column(Text)
    always_rules: Mapped[str | None] = mapped_column(Text)
    never_rules: Mapped[str | None] = mapped_column(Text)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class KnowledgeChunk(Base):
    """Fragmento lexical; una futura columna vectorial no cambia el aislamiento."""

    __tablename__ = "knowledge_chunks"
    __table_args__ = (
        Index("uq_knowledge_chunks_document_ordinal", "document_id", "ordinal", unique=True),
        Index(
            "idx_knowledge_chunks_search_es",
            text("to_tsvector('spanish'::regconfig, content)"),
            postgresql_using="gin",
        ),
    )

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    document_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False),
        ForeignKey("knowledge_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Lead(Base):
    __tablename__ = "leads"

    # Identidad estable del CRM. Los identificadores externos de WhatsApp
    # viven en whatsapp_identities y nunca vuelven a ser la PK del lead.
    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
        server_default=func.gen_random_uuid(),
    )
    # wa_id del contacto, para mostrar y buscar. El envío no lo lee de acá
    # sino de whatsapp_identities.
    telefono: Mapped[str | None] = mapped_column(Text)
    # Número informativo (llamadas, contacto alternativo) distinto del que usa
    # WhatsApp para enrutar mensajes: texto libre, sin efecto sobre el envío.
    telefono_secundario: Mapped[str | None] = mapped_column(Text)
    nombre: Mapped[str | None] = mapped_column(Text)
    nombre_usuario: Mapped[str | None] = mapped_column(Text)
    servicio_interes: Mapped[str | None] = mapped_column(Text)
    vendedor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Columna histórica conservada temporalmente para integraciones antiguas.
    # La fuente de verdad dentro del CRM es vendedor_id.
    vendedor: Mapped[str | None] = mapped_column(Text)
    origen: Mapped[str | None] = mapped_column(Text)
    notas: Mapped[str | None] = mapped_column(Text)
    # Clave de una etapa del negocio (lead_stages.key). Era el enum
    # lead_estado, igual para todos; ver d9e2a4c7f1b5. La FK garantiza que la
    # clave exista; que esté activa lo valida services/lead_stages.py.
    estado: Mapped[str] = mapped_column(
        Text,
        ForeignKey("lead_stages.key", onupdate="CASCADE", ondelete="RESTRICT"),
        default=INITIAL_LEAD_STAGE,
        server_default=INITIAL_LEAD_STAGE,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Columna histórica de la migración a n8n (b7a2c9d41e08), hoy la escribe
    # únicamente ensure_lead_stub al crear el lead. Nadie la actualiza todavía
    # en mensajes posteriores -- ver services/db_service.py:insert_message --
    # así que por ahora solo sirve como fecha del primer mensaje, no del último.
    ultimo_mensaje_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Último momento en que se abrió el chat en el panel — se compara contra
    # wsp_messages.sent_at de los mensajes del cliente para saber cuántos
    # quedaron sin ver (ver services/db_service.py:_unread_count_subquery).
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Última vez que un bot/automatización (sin actor_user_id humano) le
    # respondió al cliente. Si es más reciente que last_read_at, el chat
    # está "atendido" aunque ningún vendedor lo haya visto todavía — el
    # badge de no leídos lo distingue con otro color en vez de tratarlo
    # igual que un mensaje sin ninguna respuesta.
    last_automated_reply_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Última respuesta de n8n para este lead (SuggestionResponse serializado)
    # y cuándo se generó. Se sirve directo mientras no llegue un mensaje
    # nuevo del cliente después de cached_suggestion_at — ver
    # services/db_service.py:get_cached_suggestion.
    cached_suggestion: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    cached_suggestion_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Chat derivado a un especialista humano — flag independiente del estado,
    # no una etapa del Kanban.
    con_especialista: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Corta el piloto automático para este lead puntual (los triggers de
    # sistema — lead_created, stage_changed, message_received, etc. — dejan
    # de programar ejecuciones nuevas) sin tocar el chat en sí: el vendedor
    # sigue viendo y mandando mensajes normal. Un flujo iniciado a mano desde
    # el chat (FlowPicker) ignora esta pausa a propósito. Ver
    # automation_service.schedule_automation_event.
    automatizacion_pausada: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Estado comercial de la conversación, independiente de la ventana de
    # atención de WhatsApp. Un mensaje del cliente hace la transición
    # cerrada -> abierta y esa transición emite conversation_started una sola
    # vez. El vendedor la cierra cuando considera terminada la atención.
    conversacion_abierta: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    conversacion_abierta_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    conversacion_cerrada_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    conversacion_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    razon_perdido: Mapped[str | None] = mapped_column(Text)
    # Las escribía solo el agente analista de n8n con un UPDATE directo; se
    # declaran para poder hacerlo por la API (ver routers/webhooks.py). La
    # tabla `leads` está fuera de autogenerate, así que no llevan migración.
    tipo_objecion: Mapped[str | None] = mapped_column(Text)
    ultimo_emisor: Mapped[str | None] = mapped_column(Text)
    fecha_recontacto: Mapped[date | None] = mapped_column(Date)
    contador_noshow: Mapped[int | None] = mapped_column(SmallInteger)
    proxima_cita: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    toques_seguimiento: Mapped[int | None] = mapped_column(SmallInteger)
    fecha_ultimo_toque: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Datos definidos por cada negocio. Las definiciones viven en
    # custom_field_definitions y este JSONB conserva los valores por clave
    # estable, sin agregar una columna nueva por cliente.
    custom_fields: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )

    __table_args__ = (Index("idx_leads_vendedor_id", vendedor_id),)


class WhatsAppIdentity(Base):
    """Identificador de Meta (``wa_id`` o ``user_id``) que apunta a un lead.

    Los valores son los literales que manda Meta, sin sufijos. Un contacto
    puede tener los dos; cualquiera de ellos resuelve al mismo lead.
    ``phone_number_id`` es el número del negocio por el que se lo vio, o
    ``'*'`` si el lead se creó a mano y todavía no llegó ningún evento.
    """

    __tablename__ = "whatsapp_identities"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    phone_number_id: Mapped[str] = mapped_column(Text, nullable=False)
    identifier: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    lead_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False),
        ForeignKey("leads.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint("kind IN ('wa_id', 'user_id')", name="whatsapp_identities_kind_check"),
        Index("uq_whatsapp_identities_kind_identifier", kind, identifier, unique=True),
        Index("idx_whatsapp_identities_lead", lead_id),
    )


class WhatsappAdConversion(Base):
    """Clic a un anuncio de WhatsApp (Click-to-WhatsApp) y, si el contacto
    termina comprando, el resultado de esa venta. Llega vía webhook/n8n desde
    la plataforma de anuncios; ctwaclid es la clave que la correlaciona con el
    ``referral`` del primer mensaje (wsp_messages.provider_payload). lead_id
    se resuelve por telefono contra whatsapp_identities al insertar, pero
    puede quedar NULL si todavía no existe un lead con ese número.
    """

    __tablename__ = "wsp_ad"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lead_id: Mapped[str | None] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="SET NULL")
    )
    telefono: Mapped[str] = mapped_column(Text, nullable=False)
    ctwaclid: Mapped[str | None] = mapped_column(Text)
    id_transaccion: Mapped[str | None] = mapped_column(Text)
    source_id: Mapped[int | None] = mapped_column(BigInteger)
    nombre: Mapped[str | None] = mapped_column(Text)
    apellido: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    ciudad: Mapped[str | None] = mapped_column(Text)
    provincia: Mapped[str | None] = mapped_column(Text)
    pais: Mapped[str | None] = mapped_column(Text)
    moneda: Mapped[str | None] = mapped_column(Text)
    valor_venta: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    item_id: Mapped[str | None] = mapped_column(Text)
    item_nombre: Mapped[str | None] = mapped_column(Text)
    mensaje: Mapped[str | None] = mapped_column(Text)
    cta: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)
    thumbnail_url: Mapped[str | None] = mapped_column(Text)
    # Estado de la transacción tal como la reporta la plataforma de origen
    # (ej. pendiente/aprobada/reembolsada). No es el estado del lead.
    estado_transaccion: Mapped[str | None] = mapped_column(Text)
    plataforma: Mapped[str | None] = mapped_column(Text)
    # Si ya se aplicó al lead (attribution, notas, etc.) o sigue pendiente.
    procesado: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    fecha_interaccion: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("idx_wsp_ad_lead", lead_id),
        Index("idx_wsp_ad_telefono", telefono),
        Index("idx_wsp_ad_ctwaclid", ctwaclid),
    )


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


class AppSetting(Base):
    """Configuración editable desde la app (API keys de servicios externos:
    n8n, Meta, ElevenLabs, y los que se vayan sumando). Los valores acá
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


class AuthLoginThrottle(Base):
    """Contador compartido por todas las instancias del backend de un tenant."""

    __tablename__ = "auth_login_throttles"

    key_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("idx_auth_login_throttles_window", window_started_at),)


class AdminTotp(Base):
    """Segundo factor opcional del admin; secretos siempre cifrados en reposo."""

    __tablename__ = "admin_totp"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    secret_ciphertext: Mapped[str | None] = mapped_column(Text)
    pending_ciphertext: Mapped[str | None] = mapped_column(Text)
    pending_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_step: Mapped[int | None] = mapped_column(BigInteger)


class AdminTotpRecoveryCode(Base):
    __tablename__ = "admin_totp_recovery_codes"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    code_hash: Mapped[str] = mapped_column(Text, primary_key=True)


class AuthActionToken(Base):
    """Token de invitación o recuperación, aislado dentro del tenant.

    El valor que viaja por correo nunca se persiste: solo guardamos SHA-256.
    ``used_at`` hace el consumo de un solo uso auditable y atómico.
    """

    __tablename__ = "auth_action_tokens"

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "purpose IN ('invitation', 'password_reset')",
            name="auth_action_tokens_purpose_check",
        ),
        Index("idx_auth_action_tokens_user", user_id, purpose, used_at),
        Index("idx_auth_action_tokens_expires", expires_at),
    )


class EmailNotificationLog(Base):
    """Deduplicación tenant-scoped de avisos operativos por correo."""

    __tablename__ = "email_notification_log"

    event_key: Mapped[str] = mapped_column(Text, primary_key=True)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "status IN ('sending', 'sent')",
            name="email_notification_log_status_check",
        ),
        Index("idx_email_notification_log_type", event_type, sent_at),
    )


class TrustedDevice(Base):
    """Dispositivo que puede volver a autenticarse con un PIN local.

    El navegador conserva el token original en una cookie HttpOnly; la base
    guarda únicamente su SHA-256. El PIN también se guarda con bcrypt y nunca
    funciona sin el token aleatorio de este dispositivo.
    """

    __tablename__ = "trusted_devices"

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    pin_hash: Mapped[str | None] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    failed_pin_attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_trusted_devices_user", user_id, revoked_at),
        Index("idx_trusted_devices_expires", expires_at),
    )


class AuthSession(Base):
    """Sesión opaca, renovable y revocable de un navegador."""

    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    trusted_device_id: Mapped[str | None] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("trusted_devices.id", ondelete="SET NULL")
    )
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    previous_token_hash: Mapped[str | None] = mapped_column(Text, unique=True)
    previous_token_valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    auth_method: Mapped[str] = mapped_column(Text)  # password | pin
    persistent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    idle_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    absolute_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    rotated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    device_name: Mapped[str] = mapped_column(Text)

    __table_args__ = (
        Index("idx_auth_sessions_user", user_id, revoked_at),
        Index("idx_auth_sessions_expires", idle_expires_at, absolute_expires_at),
        Index("idx_auth_sessions_device", trusted_device_id),
    )


class LeadStage(Base):
    """Etapa del embudo, administrable por cada negocio.

    ``key`` es la clave estable que guardan ``leads.estado``, las
    automatizaciones, las plantillas y el historial: renombrar la etapa solo
    cambia ``name``. ``kind`` es la semántica que usa el código (ver
    domain_types.LeadStageKind), nunca el nombre. Una etapa en uso no se
    borra: se desactiva, y deja de ofrecerse como destino.
    """

    __tablename__ = "lead_stages"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    color: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(Text, default="open", server_default="open")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    # Criterio del negocio para usar la etapa. Lo recibe el analista IA, que
    # no conoce las etapas propias de cada negocio.
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("key ~ '^[a-z][a-z0-9_]{0,39}$'", name="lead_stages_key_check"),
        CheckConstraint("color ~ '^#[0-9a-f]{6}$'", name="lead_stages_color_check"),
        CheckConstraint("kind IN ('open', 'won', 'lost')", name="lead_stages_kind_check"),
        CheckConstraint("key <> 'nuevo' OR is_active", name="lead_stages_initial_active_check"),
        Index("uq_lead_stages_name_lower", func.lower(name), unique=True),
    )


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


class LeadTagAssignment(Base):
    __tablename__ = "lead_tag_assignments"

    lead_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="CASCADE"), primary_key=True
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
    lead_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="CASCADE"))
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
    lead_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="CASCADE"))
    author_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_lead_notes_lead_created", lead_id, created_at, id),
        Index("idx_lead_notes_author", author_user_id),
    )


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
    lead_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="SET NULL"))
    source_id: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_user_notifications_user_created", user_id, created_at.desc()),
        Index("idx_user_notifications_user_read", user_id, read_at),
        Index("idx_user_notifications_lead", lead_id),
    )


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(Text)
    auth: Mapped[str] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("idx_push_subscriptions_user", user_id),)


class IssueReport(Base):
    __tablename__ = "issue_reports"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    reporter_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        Text, default=IssueReportStatus.NEW, server_default=IssueReportStatus.NEW.value,
    )
    priority: Mapped[str] = mapped_column(
        Text, default=IssueReportPriority.NORMAL, server_default=IssueReportPriority.NORMAL.value,
    )
    current_path: Mapped[str] = mapped_column(Text)
    lead_id: Mapped[str | None] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="SET NULL")
    )
    technical_context: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "status IN ('new', 'in_review', 'needs_info', 'resolved')",
            name="ck_issue_reports_status",
        ),
        CheckConstraint(
            "priority IN ('low', 'normal', 'high', 'critical')",
            name="ck_issue_reports_priority",
        ),
        Index("idx_issue_reports_status_created", status, created_at.desc()),
        Index("idx_issue_reports_reporter_created", reporter_user_id, created_at.desc()),
    )


class IssueReportAttachment(Base):
    __tablename__ = "issue_report_attachments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(
        ForeignKey("issue_reports.id", ondelete="CASCADE")
    )
    media_url: Mapped[str] = mapped_column(Text, unique=True)
    filename: Mapped[str] = mapped_column(Text)
    content_type: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("idx_issue_report_attachments_report", report_id),)


class IssueReportComment(Base):
    __tablename__ = "issue_report_comments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("issue_reports.id", ondelete="CASCADE"))
    author_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("idx_issue_report_comments_report_created", report_id, created_at),)


class IssueReportEvent(Base):
    __tablename__ = "issue_report_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("issue_reports.id", ondelete="CASCADE"))
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    event_type: Mapped[str] = mapped_column(Text)
    previous_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("idx_issue_report_events_report_created", report_id, created_at),)


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


class Appointment(Base):
    """Registro de cada envío del formulario "Nueva Cita" del CRM (el que
    reemplazó al Form Trigger de n8n), con el resultado real que devolvió
    el workflow — se guarda incluso cuando n8n rechazó o duplicó la cita,
    para poder revisar fallos desde el Historial."""

    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    nombre_completo: Mapped[str] = mapped_column(Text)
    dni: Mapped[str] = mapped_column(Text, default="", server_default="")
    telefono: Mapped[str] = mapped_column(Text)
    tratamiento: Mapped[str] = mapped_column(Text)
    detalle: Mapped[str] = mapped_column(Text, default="", server_default="")
    fecha: Mapped[date] = mapped_column(Date)
    hora: Mapped[str] = mapped_column(Text)
    vendedor: Mapped[str] = mapped_column(Text)
    adelanto: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0, server_default="0")
    comprobante_filename: Mapped[str | None] = mapped_column(Text)
    test_mode: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    status: Mapped[str] = mapped_column(Text)
    n8n_status: Mapped[str | None] = mapped_column(Text)
    message: Mapped[str | None] = mapped_column(Text)
    event_link: Mapped[str | None] = mapped_column(Text)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=60, server_default="60")
    custom_fields: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    calendar_event_id: Mapped[str | None] = mapped_column(Text)
    calendar_sync_status: Mapped[str] = mapped_column(Text, default="not_configured", server_default="not_configured")
    calendar_sync_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "status IN ('created', 'duplicate', 'created_with_errors', 'error')",
            name="ck_appointments_status",
        ),
        CheckConstraint("duration_minutes BETWEEN 5 AND 1440", name="ck_appointments_duration"),
        CheckConstraint(
            "calendar_sync_status IN ('not_configured', 'pending', 'synced', 'error', 'skipped')",
            name="ck_appointments_calendar_sync",
        ),
        Index("idx_appointments_created", created_at.desc()),
        Index("idx_appointments_date_time", fecha, hora),
    )


class LeadTask(Base):
    __tablename__ = "lead_tasks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lead_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    task_type: Mapped[str] = mapped_column(Text, default=TaskType.FOLLOW_UP)
    status: Mapped[str] = mapped_column(Text, default=TaskStatus.PENDING)
    priority: Mapped[str] = mapped_column(Text, default=TaskPriority.NORMAL)
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
        Index("idx_lead_tasks_created_by", created_by_user_id),
        Index("idx_lead_tasks_completed_by", completed_by_user_id),
        Index("idx_lead_tasks_due_pending", due_at, postgresql_where=text("status = 'pending'")),
        Index(
            "idx_lead_tasks_pending_reminder",
            remind_at,
            postgresql_where=text("status = 'pending' AND reminder_sent_at IS NULL"),
        ),
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


class MediaAsset(Base):
    __tablename__ = "media_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    media_url: Mapped[str] = mapped_column(Text, unique=True)
    content_type: Mapped[str] = mapped_column(Text)
    filename: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    uploaded_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Con descripción, el asistente IA puede proponer este archivo como
    # adjunto de una sugerencia; sin ella no lo ve.
    ai_description: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("idx_media_assets_created_at", created_at.desc()),
        Index("idx_media_assets_content_type", content_type),
        Index("idx_media_assets_uploaded_by", uploaded_by_user_id),
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


class AutomationRule(Base):
    __tablename__ = "automation_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text)
    trigger_type: Mapped[str] = mapped_column(Text)
    trigger_config: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    conditions: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    actions: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    builder_mode: Mapped[str] = mapped_column(
        Text,
        default=AutomationBuilderMode.SIMPLE,
        server_default=AutomationBuilderMode.SIMPLE.value,
    )
    flow_definition: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    published_flow_definition: Mapped[dict | None] = mapped_column(JSONB)
    flow_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    delay_minutes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Tope de seguridad: si se completan >= N ejecuciones en la última hora,
    # las siguientes se re-agendan para más tarde en vez de correr — protege
    # contra un bug o una condición mal armada que dispare de más y arriesgue
    # el número de WhatsApp por spam. None = sin límite.
    max_executions_per_hour: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Solo aplica a flujos visuales con trigger_type=manual: si está en True,
    # el flujo aparece en el selector "Iniciar flujo" del vendedor dentro del
    # chat. El admin siempre puede dispararlo aunque esté en False.
    visible_to_sellers: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_automation_rules_trigger_active", trigger_type, is_active),
        Index("idx_automation_rules_builder_mode", builder_mode, is_active),
        Index("idx_automation_rules_created_by", created_by_user_id),
    )


class AutomationFlowVersion(Base):
    """Definición publicada de un flujo visual, una fila por versión. Las
    ejecuciones guardan (rule_id, flow_version) en flow_state y resuelven la
    definición acá — así una ejecución con esperas termina con la versión con
    la que arrancó aunque el flujo se republique."""

    __tablename__ = "automation_flow_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_id: Mapped[int] = mapped_column(ForeignKey("automation_rules.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    definition: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("uq_automation_flow_versions_rule_version", rule_id, version, unique=True),
    )


class AutomationRoundRobinState(Base):
    """Turno actual de cada bloque Round robin, una fila por (regla, bloque).

    El reparto es global del bloque, no por lead: la ejecución número N sale
    por `outputs[N % cantidad_de_salidas]`, así los leads se distribuyen en
    partes iguales entre las salidas. Vive fuera de automation_executions
    porque el contador tiene que sobrevivir a cada ejecución y avanzar de a
    uno aunque varias corran en paralelo (UPDATE atómico con RETURNING).
    """

    __tablename__ = "automation_round_robin_state"

    rule_id: Mapped[int] = mapped_column(
        ForeignKey("automation_rules.id", ondelete="CASCADE"), primary_key=True,
    )
    node_id: Mapped[str] = mapped_column(Text, primary_key=True)
    counter: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AutomationExecution(Base):
    __tablename__ = "automation_executions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    rule_id: Mapped[int] = mapped_column(ForeignKey("automation_rules.id", ondelete="CASCADE"))
    lead_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="SET NULL"))
    trigger_type: Mapped[str] = mapped_column(Text)
    event_key: Mapped[str] = mapped_column(Text)
    event_payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    status: Mapped[str] = mapped_column(
        Text,
        default=AutomationExecutionStatus.SCHEDULED,
        server_default=AutomationExecutionStatus.SCHEDULED.value,
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Momento en que la ejecución quedó congelada por la pausa del lead. Con
    # scheduled_for intacto alcanza para devolverle al reanudar exactamente el
    # tiempo que le faltaba: scheduled_for += (ahora - paused_at).
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Quién congeló esta ejecución: 'lead' si fue pausar el lead entero (el
    # botón del bot en la cabecera del chat), 'execution' si el vendedor pausó
    # solo esta desde el panel de automatizaciones. Reanudar el lead no
    # descongela las de alcance 'execution'. NULL es lo que dejaron las pausas
    # anteriores a la columna y se lee como 'lead'.
    pause_scope: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    action_results: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    flow_state: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Quién y cómo arrancó esta ejecución: 'system' para todos los triggers
    # automáticos de siempre, 'manual' cuando la inicia un vendedor con el
    # botón "Iniciar flujo" del chat. started_by_user_id solo se llena en el
    # caso manual. 'flow' identifica una ejecución creada por otro flujo.
    start_source: Mapped[str] = mapped_column(Text, default="system", server_default="system")
    started_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Un admin autorizó a ESTA ejecución a enviar con la ventana de atención
    # de 24 h cerrada, desde la alerta del fallo. Es puntual y auditado: la
    # próxima ejecución de la misma regla vuelve a respetar la ventana.
    window_override_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    window_override_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("uq_automation_execution_rule_event", rule_id, event_key, unique=True),
        Index("idx_automation_executions_due", status, scheduled_for),
        Index("idx_automation_executions_rule_created", rule_id, created_at.desc()),
        Index("idx_automation_executions_lead_created", lead_id, created_at.desc()),
        # Un solo flujo manual activo (scheduled/running/paused) por lead — el
        # vendedor puede repetirlo una vez que el anterior llegó a un estado
        # terminal. Una congelada a mano sigue contando: si no, el vendedor
        # podría arrancar una segunda y terminar con las dos en paralelo al
        # reanudar. Los triggers de sistema no entran acá: ya dedupan por
        # event_key fijo.
        Index(
            "uq_automation_executions_manual_active_per_lead",
            rule_id, lead_id,
            unique=True,
            postgresql_where=text(
                "start_source = 'manual' AND status IN ('scheduled', 'running', 'paused')"
            ),
        ),
        CheckConstraint(
            "start_source IN ('system', 'manual', 'flow')",
            name="ck_automation_executions_start_source",
        ),
    )
