from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    SmallInteger,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from domain_types import (
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


class LeadStage(str, Enum):
    nuevo = "nuevo"
    en_diagnostico = "en_diagnostico"
    calificado = "calificado"
    oferta_presentada = "oferta_presentada"
    en_objecion = "en_objecion"
    agendado = "agendado"
    cliente_activo = "cliente_activo"
    postventa = "postventa"
    en_seguimiento = "en_seguimiento"
    en_nutricion = "en_nutricion"
    perdido = "perdido"
    descalificado = "descalificado"
    baja = "baja"


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
    # Compatibilidad transitoria para integraciones antiguas durante el
    # despliegue coordinado con n8n. Ya no participa en relaciones internas.
    legacy_remote_jid: Mapped[str | None] = mapped_column("remote_jid", Text, unique=True)
    telefono: Mapped[str | None] = mapped_column(Text)
    # Número informativo (llamadas, contacto alternativo) distinto del que usa
    # WhatsApp para enrutar mensajes. A diferencia de `telefono`, no pasa por
    # whatsapp_identities ni por los triggers de la migración 028 — es un dato
    # de texto libre que se muestra en el CRM, sin efecto sobre el envío.
    telefono_secundario: Mapped[str | None] = mapped_column(Text)
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
    fecha_recontacto: Mapped[date | None] = mapped_column(Date)
    contador_noshow: Mapped[int | None] = mapped_column(SmallInteger)
    proxima_cita: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    toques_seguimiento: Mapped[int | None] = mapped_column(SmallInteger)
    fecha_ultimo_toque: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("idx_leads_vendedor_id", vendedor_id),)


class WhatsAppIdentity(Base):
    """Alias de WhatsApp que apunta al lead canónico del CRM.

    WhatsApp puede representar a la misma persona mediante un JID telefónico
    (``@s.whatsapp.net``) o mediante un LID privado (``@lid``). El lead conserva
    un identificador interno estable; esta tabla permite resolver cualquiera
    de los dos identificadores sin crear otro lead.
    """

    __tablename__ = "whatsapp_identities"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    instance: Mapped[str] = mapped_column(Text, nullable=False)
    jid: Mapped[str] = mapped_column(Text, nullable=False)
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
        CheckConstraint("kind IN ('phone', 'lid')", name="whatsapp_identities_kind_check"),
        Index("uq_whatsapp_identities_instance_jid", instance, jid, unique=True),
        Index("idx_whatsapp_identities_lead", lead_id),
    )


class WhatsappAdConversion(Base):
    """Clic a un anuncio de WhatsApp (Click-to-WhatsApp) y, si el contacto
    termina comprando, el resultado de esa venta. Llega vía webhook/n8n desde
    la plataforma de anuncios; ctwaclid es la clave que la correlaciona con el
    ad_referral embebido en el primer mensaje de wsp_messages.payload. lead_id
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

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    chat_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="CASCADE")
    )
    sender: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    media_url: Mapped[str | None] = mapped_column(Text)
    # ID del mensaje en WhatsApp (key.id de Evolution API) — permite matchear
    # los eventos de cambio de estado (entregado/leído) contra esta fila.
    wa_message_id: Mapped[str | None] = mapped_column(Text)
    # SERVER_ACK / DELIVERY_ACK / READ / PLAYED, tal cual lo manda Evolution
    # API. En mensajes del cliente, READ/PLAYED también permite sincronizar la
    # lectura hecha desde un dispositivo vinculado (p. ej. WhatsApp Web).
    status: Mapped[str | None] = mapped_column(Text)
    # Dimensiones de la imagen adjunta, calculadas de forma perezosa al servir
    # el chat: el frontend reserva el espacio exacto antes de que cargue.
    # 0/0 significa "no se pudo medir, no reintentar"; NULL, "todavía no".
    media_width: Mapped[int | None] = mapped_column(Integer)
    media_height: Mapped[int | None] = mapped_column(Integer)
    # Mensaje al que responde este (cita estilo WhatsApp). Se guarda el
    # wa_message_id y no la clave primaria porque es el único identificador
    # que comparten la app, Evolution y n8n: en las respuestas del cliente
    # llega como contextInfo.stanzaId. La fila local se resuelve por
    # (chat_id, wa_message_id) al servir el historial, apoyándose en el índice
    # único de wa_message_id declarado más abajo.
    quoted_wa_message_id: Mapped[str | None] = mapped_column(Text)
    # Discriminador de tipo (taxonomía completa de WhatsApp/Evolution). Reemplaza
    # a los pseudo-tags que antes vivían embebidos en `content`. El CHECK de la
    # base lo restringe a MESSAGE_TYPES; el frontend elige ícono/render por acá.
    # NULL sólo en filas legadas todavía sin backfillear.
    message_type: Mapped[str | None] = mapped_column(Text)
    # Enriquecimiento generado con IA para adjuntos (descripción de imagen/video,
    # transcripción de audio, OCR de documento). Estructura:
    # {summary, kind: "descripcion"|"transcripcion", model, generated_at, version}.
    # Va aparte de `content` para no mostrárselo al vendedor dentro de la burbuja
    # y poder regenerarlo sin pisar el caption. NULL si no hay análisis.
    # none_as_null: sin él, un None de Python se guarda como el literal JSON
    # `null` (no SQL NULL), y las consultas `IS NULL`/`->>'summary'` fallan.
    analysis: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    # Datos estructurados propios de cada tipo que antes se metían a la fuerza en
    # `content` o se perdían: lat/lon de ubicación, filename de documento,
    # opciones de encuesta, contactos, config de listas/botones, etc. NULL si el
    # tipo no lo necesita (texto, sticker).
    payload: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    # Reacciones sobre ESTE mensaje (badge estilo WhatsApp, no una fila aparte):
    # lista de {emoji, from_me}, a lo sumo una entrada por lado en un chat 1:1.
    # Las escribe set_message_reaction, tanto desde el webhook entrante como
    # desde el envío del vendedor. NULL cuando nadie reaccionó.
    reactions: Mapped[list | None] = mapped_column(JSONB(none_as_null=True))
    # Última vez que se reescribió el texto (WhatsApp permite editar un mensaje
    # propio de texto dentro de los 15 minutos). `content` guarda el texto
    # vigente; esta marca es la que habilita el "Editado" de la burbuja.
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Eliminado para todos. Borrado lógico: la fila queda para la auditoría del
    # CRM, pero la API deja de servir contenido y adjunto (ver _mask_deleted en
    # db_service) y el hilo pinta la lápida, igual que WhatsApp.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # messageContextInfo.messageSecret del mensaje ORIGINAL (crudo, sin API que
    # lo exponga): permite descifrar una edición nativa futura de WhatsApp, que
    # desde ~mayo 2026 llega cifrada (secretEncryptedMessage) en vez de en texto
    # plano. Ver services/message_edit_crypto.py. NULL si Evolution no lo mandó.
    message_secret: Mapped[bytes | None] = mapped_column(LargeBinary)
    # Fijado nativo del CRM: WhatsApp no expone ningún endpoint para fijar un
    # mensaje del lado de quien envía (ni Evolution API ni Baileys lo tienen),
    # así que esto vive solo acá — no se replica hacia WhatsApp. Hasta 3 por
    # chat, igual que el límite real de WhatsApp (se aplica en db_service).
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pinned_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

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
        # UNIQUE, no sólo índice: Evolution API reenvía el mismo webhook cuando
        # no recibe confirmación, y sin la restricción el reintento inserta el
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_message_outbox_pending", status, next_attempt_at, id),
        Index("idx_message_outbox_chat_order", chat_id, id),
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
    failed_pin_attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
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
    persistent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
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
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("uq_lead_services_name_lower", func.lower(name), unique=True),
        Index("idx_lead_services_created_by", created_by),
    )


class TemplateCategory(Base):
    """Categorías consistentes para las plantillas compartidas del CRM."""

    __tablename__ = "template_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("idx_push_subscriptions_user", user_id),)


class IssueReport(Base):
    __tablename__ = "issue_reports"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    reporter_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default=IssueReportStatus.NEW)
    priority: Mapped[str] = mapped_column(Text, default=IssueReportPriority.NORMAL)
    current_path: Mapped[str] = mapped_column(Text)
    lead_id: Mapped[str | None] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="SET NULL")
    )
    technical_context: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("idx_issue_report_attachments_report", report_id),)


class IssueReportComment(Base):
    __tablename__ = "issue_report_comments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("issue_reports.id", ondelete="CASCADE"))
    author_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("idx_issue_report_comments_report_created", report_id, created_at),)


class IssueReportEvent(Base):
    __tablename__ = "issue_report_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("issue_reports.id", ondelete="CASCADE"))
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    event_type: Mapped[str] = mapped_column(Text)
    previous_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("idx_issue_report_events_report_created", report_id, created_at),)


class Appointment(Base):
    """Registro de cada envío del formulario "Nueva Cita" del CRM (el que
    reemplazó al Form Trigger de n8n), con el resultado real que devolvió
    el workflow — se guarda incluso cuando n8n rechazó o duplicó la cita,
    para poder revisar fallos desde el Historial."""

    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    nombre_completo: Mapped[str] = mapped_column(Text)
    dni: Mapped[str] = mapped_column(Text, default="")
    telefono: Mapped[str] = mapped_column(Text)
    tratamiento: Mapped[str] = mapped_column(Text)
    detalle: Mapped[str] = mapped_column(Text, default="")
    fecha: Mapped[date] = mapped_column(Date)
    hora: Mapped[str] = mapped_column(Text)
    vendedor: Mapped[str] = mapped_column(Text)
    adelanto: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    comprobante_filename: Mapped[str | None] = mapped_column(Text)
    test_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(Text)
    n8n_status: Mapped[str | None] = mapped_column(Text)
    message: Mapped[str | None] = mapped_column(Text)
    event_link: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "status IN ('created', 'duplicate', 'created_with_errors', 'error')",
            name="ck_appointments_status",
        ),
        Index("idx_appointments_created", created_at.desc()),
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
