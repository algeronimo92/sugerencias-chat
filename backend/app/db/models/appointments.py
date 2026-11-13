"""Modelos ORM del dominio appointments."""

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class Appointment(Base):
    """Registro de cada envío del formulario "Nueva Cita" del CRM (el que
    reemplazó al Form Trigger de n8n), con el resultado real que devolvió
    el workflow — se guarda incluso cuando n8n rechazó o duplicó la cita,
    para poder revisar fallos desde el Historial."""

    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    # Lead al que pertenece la cita, resuelto por teléfono al registrarla. NULL
    # cuando ese número no coincide con ningún lead o coincide con más de uno:
    # preferimos no vincularla antes que colgarla del lead equivocado.
    lead_id: Mapped[str | None] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="SET NULL")
    )
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
        Index(
            "idx_appointments_lead_created",
            lead_id,
            created_at.desc(),
            postgresql_where=text("lead_id IS NOT NULL"),
        ),
        # Citas del período por quien las registró: lo que agrupa el
        # dashboard del vendedor (leads/dashboard/appointments_queries.py).
        Index("idx_appointments_creator_created", created_by_user_id, created_at.desc()),
    )


class AppointmentNotice(Base):
    """Cada aviso de WhatsApp que generó una cita: al cliente (en el chat de
    su lead) o a alguien del equipo (directo a su número). Antes el aviso al
    equipo no dejaba rastro fuera de los logs y no se sabía si había llegado.

    ``provider_message_id`` es el id que devolvió Meta: con él los estados del
    webhook marcan el aviso como entregado o leído. Para el del cliente, que
    sale por el outbox y recibe ese id después, se guarda ``wsp_message_id``."""

    __tablename__ = "appointment_notices"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    appointment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("appointments.id", ondelete="CASCADE"), nullable=False,
    )
    audience: Mapped[str] = mapped_column(Text, nullable=False)
    recipient_name: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[int | None] = mapped_column(Integer)
    phone: Mapped[str | None] = mapped_column(Text)
    template_id: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    provider_message_id: Mapped[str | None] = mapped_column(Text)
    wsp_message_id: Mapped[int | None] = mapped_column(BigInteger)
    delivery_status: Mapped[str | None] = mapped_column(Text)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )

    __table_args__ = (
        CheckConstraint("audience IN ('client', 'staff')", name="ck_appointment_notices_audience"),
        CheckConstraint("status IN ('sent', 'failed', 'skipped')", name="ck_appointment_notices_status"),
        CheckConstraint(
            "delivery_status IS NULL OR delivery_status IN ('sent', 'delivered', 'read', 'failed')",
            name="ck_appointment_notices_delivery",
        ),
        Index("idx_appointment_notices_appointment", appointment_id),
        Index(
            "idx_appointment_notices_provider", provider_message_id, unique=True,
            postgresql_where=text("provider_message_id IS NOT NULL"),
        ),
        Index(
            "idx_appointment_notices_wsp_message", wsp_message_id,
            postgresql_where=text("wsp_message_id IS NOT NULL"),
        ),
    )
