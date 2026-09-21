"""Verificación delegada del webhook de Meta, para que n8n no guarde secretos.

n8n no puede crear variables de entorno en su plan actual. En vez de que el
Code node de n8n compare el verify token o recalcule el HMAC con un secreto
propio, reenvía acá el challenge/la firma y el backend responde con la
configuración que ya vive en ``app_settings``.
"""

from typing import Any

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict

from routers.webhooks.common import webhooks_router
from services.meta_webhook_auth import verify_challenge, verify_signature

router = webhooks_router()


class MetaChallengeCheck(BaseModel):
    mode: str | None = None
    verify_token: str | None = None
    challenge: str | None = None

    model_config = ConfigDict(extra="forbid")


@router.post("/meta/verify-challenge")
async def check_meta_challenge(body: MetaChallengeCheck) -> dict[str, Any]:
    ok = await verify_challenge(body.mode, body.verify_token)
    return {"ok": ok, "challenge": body.challenge or ""}


@router.post("/meta/verify-signature")
async def check_meta_signature(request: Request) -> dict[str, Any]:
    """Falla cerrado: firma ausente o inválida corta el workflow de n8n (401)."""
    raw_body = await request.body()
    signature = request.headers.get("x-hub-signature-256", "")
    if not await verify_signature(raw_body, signature):
        raise HTTPException(status_code=401, detail="Firma Meta no coincide")
    return {"ok": True}
