"""Modelos ORM del dominio leads."""

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4
from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, SmallInteger, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from domain_types import INITIAL_LEAD_STAGE
from app.db.base import Base


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
    # clave exista; que esté activa lo valida app/modules/leads/stages.py.
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
    # en mensajes posteriores -- ver app/modules/conversations/provider_messages.py --
    # así que por ahora solo sirve como fecha del primer mensaje, no del último.
    ultimo_mensaje_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Último momento en que se abrió el chat en el panel — se compara contra
    # wsp_messages.sent_at de los mensajes del cliente para saber cuántos
    # quedaron sin ver (ver app/modules/conversations/chat_queries.py).
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
    # app/modules/ai/suggestions_repository.py:get_cached_suggestion.
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
    # declaran para poder hacerlo por la API (ver app/integrations/n8n/api.py). La
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
        # Etiquetas puestas en el período, para el panel de cobertura.
        Index("idx_lead_tag_assignments_assigned_at", assigned_at.desc()),
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
        # "Qué hice esta semana": acciones de una persona ordenadas por
        # fecha. Parcial porque los eventos de sistema y de n8n no llevan
        # actor y son la mayoría de las filas.
        Index(
            "idx_lead_activity_actor_created",
            actor_user_id,
            created_at.desc(),
            postgresql_where=text("actor_user_id IS NOT NULL"),
        ),
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
