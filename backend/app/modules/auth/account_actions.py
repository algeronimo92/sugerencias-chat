"""Invitaciones, recuperación y avisos de correo aislados por tenant."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import logging
import secrets
from uuid import uuid4

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.db.models.auth import AuthActionToken, EmailNotificationLog, User
from app.db.session import get_sessionmaker
from app.modules.auth.auth_service import hash_password, invalidate_user_cache
from app.integrations.email_service import (
    EmailDeliveryError,
    EmailNotConfiguredError,
    email_is_configured,
    public_app_url,
    send_invitation,
    send_operational_alert,
    send_password_reset,
)
from app.modules.auth.session_service import revoke_all_for_user
from app.db.store_common import EmailAlreadyExistsError


logger = logging.getLogger(__name__)
INVITATION = "invitation"
PASSWORD_RESET = "password_reset"


class InvalidActionTokenError(Exception):
    pass


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_token() -> str:
    return secrets.token_urlsafe(32)


def _ensure_email_ready() -> None:
    if not email_is_configured():
        raise EmailNotConfiguredError("El correo transaccional no está configurado")
    # Valida también que exista una URL canónica antes de escribir en DB.
    public_app_url()


async def invite_user(*, email: str, name: str, role: str) -> dict:
    _ensure_email_ready()
    now = datetime.now(timezone.utc)
    raw_token = _new_token()
    normalized_email = email.strip().lower()

    async with get_sessionmaker()() as session:
        try:
            async with session.begin():
                user = (
                    await session.execute(
                        select(User).where(User.email == normalized_email).with_for_update()
                    )
                ).scalar_one_or_none()
                if user is not None and user.is_active:
                    raise EmailAlreadyExistsError(normalized_email)
                if user is None:
                    user = User(
                        email=normalized_email,
                        name=name.strip(),
                        # Nunca se entrega ni sirve como credencial conocida.
                        password_hash=hash_password(_new_token()),
                        role=role,
                        is_active=False,
                        created_at=now,
                    )
                    session.add(user)
                    await session.flush()
                else:
                    user.name = name.strip()
                    user.role = role

                await session.execute(
                    update(AuthActionToken)
                    .where(
                        AuthActionToken.user_id == user.id,
                        AuthActionToken.purpose == INVITATION,
                        AuthActionToken.used_at.is_(None),
                    )
                    .values(used_at=now)
                )
                session.add(
                    AuthActionToken(
                        id=str(uuid4()),
                        user_id=user.id,
                        purpose=INVITATION,
                        token_hash=_token_hash(raw_token),
                        created_at=now,
                        expires_at=now + timedelta(hours=settings.invitation_expire_hours),
                    )
                )
                # Si SMTP falla, la transacción se revierte: no queda una
                # cuenta fantasma que el invitado no pueda activar.
                await send_invitation(
                    recipient=user.email, name=user.name, token=raw_token
                )
        except IntegrityError as exc:
            raise EmailAlreadyExistsError(normalized_email) from exc

    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "is_active": user.is_active,
    }


async def request_password_reset(email: str) -> None:
    """Siempre retorna igual: nunca permite enumerar usuarios ni config SMTP."""

    if not email_is_configured():
        logger.info("Recuperación omitida: correo transaccional no configurado")
        return
    try:
        public_app_url()
    except EmailNotConfiguredError:
        logger.warning("Recuperación omitida: APP_PUBLIC_URL no configurada")
        return

    now = datetime.now(timezone.utc)
    raw_token = _new_token()
    try:
        async with get_sessionmaker()() as session:
            async with session.begin():
                user = (
                    await session.execute(
                        select(User).where(
                            User.email == email.strip().lower(), User.is_active.is_(True)
                        )
                    )
                ).scalar_one_or_none()
                if user is None:
                    return
                await session.execute(
                    update(AuthActionToken)
                    .where(
                        AuthActionToken.user_id == user.id,
                        AuthActionToken.purpose == PASSWORD_RESET,
                        AuthActionToken.used_at.is_(None),
                    )
                    .values(used_at=now)
                )
                session.add(
                    AuthActionToken(
                        id=str(uuid4()),
                        user_id=user.id,
                        purpose=PASSWORD_RESET,
                        token_hash=_token_hash(raw_token),
                        created_at=now,
                        expires_at=now
                        + timedelta(minutes=settings.password_reset_expire_minutes),
                    )
                )
                await send_password_reset(
                    recipient=user.email, name=user.name, token=raw_token
                )
    except (EmailDeliveryError, EmailNotConfiguredError):
        # Mismo resultado HTTP tanto si el usuario existe como si no.
        logger.warning("No se pudo enviar una recuperación de contraseña")


async def describe_action_token(token: str) -> dict:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        row = (
            await session.execute(
                select(AuthActionToken, User)
                .join(User, User.id == AuthActionToken.user_id)
                .where(AuthActionToken.token_hash == _token_hash(token))
            )
        ).first()
    if row is None:
        raise InvalidActionTokenError()
    action, user = row
    if action.used_at is not None or action.expires_at <= now:
        raise InvalidActionTokenError()
    if action.purpose == PASSWORD_RESET and not user.is_active:
        raise InvalidActionTokenError()
    return {"purpose": action.purpose, "email": user.email, "name": user.name}


async def consume_action_token(*, token: str, purpose: str, password: str) -> None:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        async with session.begin():
            row = (
                await session.execute(
                    select(AuthActionToken, User)
                    .join(User, User.id == AuthActionToken.user_id)
                    .where(AuthActionToken.token_hash == _token_hash(token))
                    .with_for_update()
                )
            ).first()
            if row is None:
                raise InvalidActionTokenError()
            action, user = row
            if (
                action.purpose != purpose
                or action.used_at is not None
                or action.expires_at <= now
                or (purpose == PASSWORD_RESET and not user.is_active)
            ):
                raise InvalidActionTokenError()

            user.password_hash = hash_password(password)
            if purpose == INVITATION:
                user.is_active = True
            action.used_at = now
            # Toda credencial anterior del mismo propósito queda consumida.
            await session.execute(
                update(AuthActionToken)
                .where(
                    AuthActionToken.user_id == user.id,
                    AuthActionToken.purpose == purpose,
                    AuthActionToken.used_at.is_(None),
                )
                .values(used_at=now)
            )
            user_id = user.id

    invalidate_user_cache(user_id)
    await revoke_all_for_user(user_id, include_devices=True)


async def _admin_recipients() -> list[str]:
    async with get_sessionmaker()() as session:
        rows = (
            await session.execute(
                select(User.email).where(User.role == "admin", User.is_active.is_(True))
            )
        ).scalars().all()
    return list(rows)


async def send_deduplicated_operational_alert(
    *, event_key: str, event_type: str, subject: str, title: str, message: str
) -> bool:
    """Entrega una vez por clave; un fallo libera la clave para reintentar."""

    if not email_is_configured():
        return False
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        result = await session.execute(
            pg_insert(EmailNotificationLog)
            .values(
                event_key=event_key,
                event_type=event_type,
                status="sending",
                created_at=now,
            )
            .on_conflict_do_nothing(index_elements=[EmailNotificationLog.event_key])
        )
        await session.commit()
        if result.rowcount == 0:
            return False

    try:
        recipients = await _admin_recipients()
        if not recipients:
            raise EmailDeliveryError("No hay administradores activos")
        await send_operational_alert(
            recipients=recipients,
            subject=subject,
            title=title,
            message=message,
        )
        async with get_sessionmaker()() as session:
            await session.execute(
                update(EmailNotificationLog)
                .where(EmailNotificationLog.event_key == event_key)
                .values(status="sent", sent_at=datetime.now(timezone.utc))
            )
            await session.commit()
        return True
    except Exception:
        logger.exception("Falló aviso operativo por correo: tipo=%s", event_type)
        async with get_sessionmaker()() as session:
            await session.execute(
                delete(EmailNotificationLog).where(
                    EmailNotificationLog.event_key == event_key,
                    EmailNotificationLog.status == "sending",
                )
            )
            await session.commit()
        return False


async def try_send_operational_alert(**kwargs) -> bool:
    """Frontera best-effort: un aviso nunca rompe la operación que reporta."""

    try:
        return await send_deduplicated_operational_alert(**kwargs)
    except Exception:
        logger.exception("No se pudo preparar un aviso operativo por correo")
        return False
