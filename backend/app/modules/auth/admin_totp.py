"""TOTP RFC 6238 y códigos de recuperación para administradores del CRM."""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert

from app.db.models.auth import AdminTotp, AdminTotpRecoveryCode
from app.core.secret_cipher import decrypt_secret, encrypt_secret
from app.tenancy.context import get_current_tenant
from app.db.uow import session_scope

STEP_SECONDS = 30
PENDING_LIFETIME = timedelta(minutes=10)
RECOVERY_COUNT = 8


class TotpSetupError(ValueError):
    pass


def _secret_key(user_id: int) -> str:
    return f"user:{user_id}"


def _namespace() -> str:
    tenant = get_current_tenant()
    return f"admin_totp:{tenant.schema_name if tenant else 'public'}"


def _encrypt(user_id: int, secret: str) -> str:
    return encrypt_secret(_secret_key(user_id), secret, namespace=_namespace())


def _decrypt(user_id: int, value: str) -> str:
    return decrypt_secret(_secret_key(user_id), value, namespace=_namespace())


def _totp(secret: str, step: int) -> str:
    raw = base64.b32decode(secret, casefold=True)
    digest = hmac.new(raw, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{number % 1_000_000:06d}"


def _matching_step(secret: str, code: str, now: int | None = None) -> int | None:
    if len(code) != 6 or not code.isascii() or not code.isdigit():
        return None
    current = (int(time.time()) if now is None else now) // STEP_SECONDS
    for step in (current - 1, current, current + 1):
        if step >= 0 and hmac.compare_digest(_totp(secret, step), code):
            return step
    return None


def _recovery_hash(code: str) -> str:
    return hashlib.sha256(code.replace("-", "").strip().upper().encode("ascii", errors="ignore")).hexdigest()


def _new_recovery_code() -> str:
    raw = secrets.token_hex(10).upper()
    return "-".join(raw[i:i + 5] for i in range(0, 20, 5))


async def mfa_status(user_id: int) -> dict:
    async with session_scope() as session:
        row = await session.get(AdminTotp, user_id)
        enabled = bool(row and row.enabled_at and row.secret_ciphertext)
        remaining = 0
        if enabled:
            remaining = await session.scalar(
                select(func.count()).select_from(AdminTotpRecoveryCode)
                .where(AdminTotpRecoveryCode.user_id == user_id)
            )
    return {"enabled": enabled, "recovery_codes_remaining": remaining}


async def start_enrollment(user_id: int, email: str) -> dict:
    secret = base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        await session.execute(
            insert(AdminTotp).values(user_id=user_id)
            .on_conflict_do_nothing(index_elements=[AdminTotp.user_id])
        )
        row = await session.scalar(
            select(AdminTotp).where(AdminTotp.user_id == user_id).with_for_update()
        )
        if row.enabled_at:
            raise TotpSetupError("La verificación en dos pasos ya está activa")
        row.pending_ciphertext = _encrypt(user_id, secret)
        row.pending_expires_at = now + PENDING_LIFETIME
    label = quote(f"CRM:{email}", safe="")
    uri = f"otpauth://totp/{label}?secret={secret}&issuer=CRM&algorithm=SHA1&digits=6&period=30"
    return {"secret": secret, "otpauth_uri": uri}


async def confirm_enrollment(user_id: int, code: str) -> list[str]:
    now = datetime.now(timezone.utc)
    recovery_codes = [_new_recovery_code() for _ in range(RECOVERY_COUNT)]
    async with session_scope() as session:
        row = await session.scalar(
            select(AdminTotp).where(AdminTotp.user_id == user_id).with_for_update()
        )
        if not row or not row.pending_ciphertext or not row.pending_expires_at or row.pending_expires_at < now or row.enabled_at:
            raise TotpSetupError("La configuración venció. Vuelve a comenzar")
        secret = _decrypt(user_id, row.pending_ciphertext)
        step = _matching_step(secret, code)
        if step is None:
            raise TotpSetupError("Código incorrecto")
        row.secret_ciphertext = row.pending_ciphertext
        row.pending_ciphertext = None
        row.pending_expires_at = None
        row.enabled_at = now
        row.last_used_step = step
        await session.execute(
            delete(AdminTotpRecoveryCode).where(AdminTotpRecoveryCode.user_id == user_id)
        )
        session.add_all(
            AdminTotpRecoveryCode(user_id=user_id, code_hash=_recovery_hash(code))
            for code in recovery_codes
        )
    return recovery_codes


async def verify_mfa(user_id: int, code: str) -> bool:
    async with session_scope() as session:
        row = await session.scalar(
            select(AdminTotp).where(AdminTotp.user_id == user_id).with_for_update()
        )
        if not row or not row.enabled_at or not row.secret_ciphertext:
            return False
        step = _matching_step(_decrypt(user_id, row.secret_ciphertext), code)
        if step is not None and (row.last_used_step is None or step > row.last_used_step):
            row.last_used_step = step
            return True
        if len(code.replace("-", "")) == 20:
            recovery = await session.get(
                AdminTotpRecoveryCode, (user_id, _recovery_hash(code))
            )
            if recovery:
                await session.delete(recovery)
                return True
    return False


async def disable_mfa(user_id: int, code: str) -> bool:
    if not await verify_mfa(user_id, code):
        return False
    async with session_scope() as session:
        await session.execute(
            delete(AdminTotpRecoveryCode).where(AdminTotpRecoveryCode.user_id == user_id)
        )
        await session.execute(delete(AdminTotp).where(AdminTotp.user_id == user_id))
    return True
