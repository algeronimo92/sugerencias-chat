"""Modelos ORM del dominio contacts: la agenda del negocio y sus importaciones."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, SmallInteger, Text, func, text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Contact(Base):
    """Persona de la agenda, haya escrito o no. Un lead es un contacto que
    entró al embudo: ``lead_id`` lo enlaza cuando existe.

    Se separó de ``leads`` porque la agenda del celular trae familia y
    proveedores: como leads habrían llenado el Kanban y disparado las
    automatizaciones de ``lead_created`` por cada uno."""

    __tablename__ = "contacts"

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid(),
    )
    nombre: Mapped[str | None] = mapped_column(Text)
    # Solo dígitos E.164, igual que leads.telefono (el wa_id de Meta).
    telefono: Mapped[str | None] = mapped_column(Text)
    # BSUID de Meta. Puede ser la única identidad: Meta no siempre manda el
    # número de un contacto sincronizado desde la app del celular.
    wa_user_id: Mapped[str | None] = mapped_column(Text)
    username: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    notas: Mapped[str | None] = mapped_column(Text)
    etiquetas: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]"),
    )
    origen: Mapped[str] = mapped_column(Text, nullable=False)
    consentimiento_marketing: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"),
    )
    consentimiento_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lead_id: Mapped[str | None] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="SET NULL"),
    )
    # Alguien lo editó en el CRM: desde ahí, el nombre que llegue del celular
    # ya no pisa el que se escribió acá.
    editado_en_crm_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Lo borraron de la app del celular. No se elimina: puede tener notas o un
    # lead enlazado en el CRM.
    eliminado_en_app_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Hora del último cambio que mandó Meta: los webhooks llegan desordenados
    # y uno más viejo no puede deshacer uno más nuevo.
    meta_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Último mensaje conocido con el contacto (historial de la app del celular).
    ultima_interaccion_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )

    __table_args__ = (
        CheckConstraint(
            "origen IN ('manual', 'csv', 'whatsapp_app', 'lead')", name="contacts_origen_check",
        ),
        CheckConstraint(
            "telefono IS NOT NULL OR wa_user_id IS NOT NULL", name="contacts_identity_check",
        ),
        Index("uq_contacts_telefono", telefono, unique=True, postgresql_where=text("telefono IS NOT NULL")),
        Index("uq_contacts_wa_user_id", wa_user_id, unique=True, postgresql_where=text("wa_user_id IS NOT NULL")),
        Index("idx_contacts_lead", lead_id),
        Index("idx_contacts_created", text("created_at DESC")),
        Index("idx_contacts_etiquetas", etiquetas, postgresql_using="gin"),
    )


class ContactImportBatch(Base):
    """Una importación por revisar: un CSV subido o lo que mandó la app del
    celular. Sus filas esperan en ``contact_import_rows`` hasta que alguien
    elige cuáles pasan a la agenda; puede hacerlo en varias tandas."""

    __tablename__ = "contact_import_batches"

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid(),
    )
    source: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="open")
    file_name: Mapped[str | None] = mapped_column(Text)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("source IN ('csv', 'whatsapp_app')", name="contact_import_batches_source_check"),
        CheckConstraint("status IN ('open', 'closed')", name="contact_import_batches_status_check"),
        # Lo que llega del celular se junta en una sola importación abierta.
        Index(
            "uq_contact_import_batches_open_whatsapp", source, unique=True,
            postgresql_where=text("status = 'open' AND source = 'whatsapp_app'"),
        ),
        Index("idx_contact_import_batches_created", text("created_at DESC")),
        Index("idx_contact_import_batches_created_by", created_by_user_id),
    )


class ContactImportRow(Base):
    __tablename__ = "contact_import_rows"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("contact_import_batches.id", ondelete="CASCADE"), nullable=False,
    )
    # Fila del archivo (CSV). Null en lo que llega del celular.
    row_number: Mapped[int | None] = mapped_column(Integer)
    # Teléfono o BSUID: una persona aparece una sola vez por importación.
    dedupe_key: Mapped[str] = mapped_column(Text, nullable=False)
    nombre: Mapped[str | None] = mapped_column(Text)
    telefono: Mapped[str | None] = mapped_column(Text)
    wa_user_id: Mapped[str | None] = mapped_column(Text)
    username: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    notas: Mapped[str | None] = mapped_column(Text)
    etiquetas: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]"),
    )
    consentimiento: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    ultima_interaccion_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    meta_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Motivo por el que la fila no se puede importar (teléfono inválido...).
    error: Mapped[str | None] = mapped_column(Text)
    # Null mientras espera; después, qué pasó con ella.
    outcome: Mapped[str | None] = mapped_column(Text)
    contact_id: Mapped[str | None] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("contacts.id", ondelete="SET NULL"),
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )

    __table_args__ = (
        CheckConstraint(
            "outcome IS NULL OR outcome IN ('created', 'updated', 'skipped', 'discarded')",
            name="contact_import_rows_outcome_check",
        ),
        Index("uq_contact_import_rows_key", batch_id, dedupe_key, unique=True),
        Index("idx_contact_import_rows_pending", batch_id, postgresql_where=text("outcome IS NULL")),
        Index("idx_contact_import_rows_contact", contact_id),
    )


class WhatsAppAppSync(Base):
    """Pedido de sincronización a la app WhatsApp Business del celular
    (coexistencia). Meta lo acepta una sola vez por tipo y solo en las 24 h
    siguientes a la conexión del número."""

    __tablename__ = "whatsapp_app_syncs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    phone_number_id: Mapped[str] = mapped_column(Text, nullable=False)
    sync_type: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    request_id: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    progress: Mapped[int | None] = mapped_column(SmallInteger)
    # Conexión del número: desde acá corren las 24 h de Meta.
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )

    __table_args__ = (
        CheckConstraint(
            "sync_type IN ('smb_app_state_sync', 'history')", name="whatsapp_app_syncs_type_check",
        ),
        CheckConstraint(
            "status IN ('requested', 'failed', 'receiving', 'done', 'declined')",
            name="whatsapp_app_syncs_status_check",
        ),
        Index("uq_whatsapp_app_syncs_number_type", phone_number_id, sync_type, unique=True),
    )


class WhatsAppHistoryChunk(Base):
    """Fragmento del historial de chats que Meta manda una sola vez al
    conectar el número. Hoy solo se usa para saber con quién hubo
    conversación y cuándo; se guarda entero porque Meta no lo vuelve a
    mandar, y sin él no habría forma de importar los mensajes más adelante."""

    __tablename__ = "whatsapp_history_chunks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    phone_number_id: Mapped[str] = mapped_column(Text, nullable=False)
    phase: Mapped[int | None] = mapped_column(SmallInteger)
    chunk_order: Mapped[int | None] = mapped_column(Integer)
    progress: Mapped[int | None] = mapped_column(SmallInteger)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )

    __table_args__ = (Index("idx_whatsapp_history_chunks_number", phone_number_id, phase, chunk_order),)


class ContactSettings(Base):
    """Preferencias de la agenda del negocio. Una sola fila (id = 1)."""

    __tablename__ = "contact_settings"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=False)
    # Los contactos nuevos del celular entran solos a la agenda en vez de
    # esperar en la importación abierta a que alguien los elija.
    auto_import_whatsapp: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )

    __table_args__ = (CheckConstraint("id = 1", name="contact_settings_single_row"),)
