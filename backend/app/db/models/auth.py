"""Modelos ORM del dominio auth."""

from datetime import datetime
from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, SmallInteger, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


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
