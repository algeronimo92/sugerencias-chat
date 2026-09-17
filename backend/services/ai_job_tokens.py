"""Tokens breves para devolver un job IA al tenant que lo creÃ³.

El token liga organizaciÃ³n, job y operaciÃ³n. No contiene ``schema_name``; el
schema siempre se vuelve a resolver en el plano de control.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
from typing import AsyncIterator
from uuid import UUID

from fastapi import Header, HTTPException

from config import settings
from tenancy.context import reset_current_tenant, set_current_tenant
from tenancy.resolver import resolve_tenant_by_organization_id


@dataclass(frozen=True, slots=True)
class AIJobClaims:
    organization_id: UUID
    job_id: str
    operation: str
    expires_at: datetime


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _signing_key() -> bytes:
    secret = settings.ai_job_signing_secret
    if not secret:
        if settings.multitenancy_enabled:
            raise RuntimeError("falta AI_JOB_SIGNING_SECRET para jobs IA multitenant")
        # Compatibilidad temporal para instalaciones single-tenant. El modo
        # multitenant falla cerrado y exige una clave dedicada.
        secret = settings.inbound_webhook_token or settings.n8n_webhook_token
    if not secret:
        raise RuntimeError("no hay una clave configurada para firmar jobs IA")
    return secret.encode("utf-8")


def issue_ai_job_token(
    organization_id: UUID,
    job_id: str,
    operation: str,
    expires_at: datetime,
) -> str:
    payload = {
        "v": 1,
        "org": str(organization_id),
        "job": str(job_id),
        "op": operation,
        "exp": int(expires_at.timestamp()),
    }
    encoded = _b64encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    signature = _b64encode(
        hmac.new(_signing_key(), encoded.encode("ascii"), hashlib.sha256).digest()
    )
    return f"{encoded}.{signature}"


def decode_ai_job_token(token: str) -> AIJobClaims:
    try:
        encoded, supplied_signature = token.split(".", 1)
        expected_signature = _b64encode(
            hmac.new(_signing_key(), encoded.encode("ascii"), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(supplied_signature, expected_signature):
            raise ValueError("signature")
        payload = json.loads(_b64decode(encoded))
        if payload.get("v") != 1 or payload.get("op") not in {"rag", "analyst", "media_analysis"}:
            raise ValueError("claims")
        expires_at = datetime.fromtimestamp(int(payload["exp"]), tz=timezone.utc)
        claims = AIJobClaims(
            organization_id=UUID(payload["org"]),
            job_id=str(UUID(payload["job"])),
            operation=payload["op"],
            expires_at=expires_at,
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Contexto de job IA invÃ¡lido") from exc
    if claims.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Contexto de job IA vencido")
    return claims


async def require_ai_job_context(
    x_tenant_context: str = Header(alias="X-Tenant-Context"),
) -> AsyncIterator[AIJobClaims]:
    """Resuelve y propaga el tenant firmado durante un callback de n8n."""

    claims = decode_ai_job_token(x_tenant_context)
    context = await resolve_tenant_by_organization_id(claims.organization_id)
    if context is None:
        raise HTTPException(status_code=401, detail="Contexto de job IA invÃ¡lido")
    token = set_current_tenant(context)
    try:
        yield claims
    finally:
        reset_current_tenant(token)
