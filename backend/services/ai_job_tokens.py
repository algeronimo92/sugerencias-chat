"""Short-lived tokens that bind an AI job to its tenant and operation."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
import logging
from typing import AsyncIterator
from uuid import UUID

from fastapi import Header, HTTPException

from config import settings
from tenancy.context import reset_current_tenant, set_current_tenant
from tenancy.resolver import resolve_tenant_by_organization_id


logger = logging.getLogger(__name__)


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
            raise RuntimeError("AI_JOB_SIGNING_SECRET is required for multitenant AI jobs")
        # Temporary compatibility for single-tenant installations.
        secret = settings.inbound_webhook_token or settings.n8n_webhook_token
    if not secret:
        raise RuntimeError("no signing key is configured for AI jobs")
    return secret.encode("utf-8")


def signing_key_configured() -> bool:
    """Permite rechazar el pedido antes de crear un job que no se podrá firmar."""
    try:
        _signing_key()
    except RuntimeError:
        return False
    return True


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
        # Firma que no coincide o valor truncado/alterado por el workflow.
        logger.warning("X-Tenant-Context rechazado: %s (largo %d)", exc, len(token or ""))
        raise HTTPException(status_code=401, detail="Contexto de job IA invalido") from exc
    if claims.expires_at <= datetime.now(timezone.utc):
        logger.warning("X-Tenant-Context vencido para el job %s", claims.job_id)
        raise HTTPException(status_code=401, detail="Contexto de job IA vencido")
    return claims


async def require_ai_job_context(
    x_tenant_context: str = Header(alias="X-Tenant-Context"),
) -> AsyncIterator[AIJobClaims]:
    """Resolve and propagate the signed tenant during an n8n callback."""

    claims = decode_ai_job_token(x_tenant_context)
    context = await resolve_tenant_by_organization_id(claims.organization_id)
    if context is None:
        logger.warning(
            "X-Tenant-Context de un negocio inactivo o sin dominio principal: %s",
            claims.organization_id,
        )
        raise HTTPException(status_code=401, detail="Contexto de job IA invalido")
    token = set_current_tenant(context)
    try:
        yield claims
    finally:
        reset_current_tenant(token)
