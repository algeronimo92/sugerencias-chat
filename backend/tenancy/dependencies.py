"""Dependencias que ligan integraciones externas a un tenant registrado."""

from collections.abc import AsyncIterator

from fastapi import Header, HTTPException, Request

from config import settings
from tenancy.context import reset_current_tenant, set_current_tenant
from tenancy.resolver import resolve_tenant_by_phone_number_id

_SELF_SCOPED_PATHS = frozenset(
    {
        "/api/webhooks/analysis-context",
        "/api/webhooks/catalog",
        "/api/webhooks/rag-search",
        "/api/webhooks/rag-context",
    }
)
_SELF_SCOPED_PREFIXES = (
    "/api/webhooks/analysis-jobs/",
    "/api/webhooks/meta-events/inbox",
    "/api/webhooks/meta/verify-",
)


def integration_path_is_self_scoped(path: str) -> bool:
    return path in _SELF_SCOPED_PATHS or any(
        path.startswith(prefix) for prefix in _SELF_SCOPED_PREFIXES
    )


async def bind_integration_tenant(
    request: Request,
    x_meta_phone_number_id: str | None = Header(default=None, alias="X-Meta-Phone-Number-Id"),
) -> AsyncIterator[None]:
    """Resuelve callbacks Meta antes de que un repositorio abra una sesión.

    El token compartido autentica a n8n; el número receptor limita el acceso
    al schema correcto. El header no se convierte en un nombre SQL.
    """
    if not settings.multitenancy_enabled or integration_path_is_self_scoped(request.url.path):
        yield
        return

    phone_number_id = (x_meta_phone_number_id or "").strip()
    if not phone_number_id:
        raise HTTPException(status_code=400, detail="Falta X-Meta-Phone-Number-Id para resolver el negocio")

    context = await resolve_tenant_by_phone_number_id(phone_number_id)
    if context is None:
        raise HTTPException(status_code=404, detail="Conexión WhatsApp no registrada")

    request.state.tenant_context = context
    token = set_current_tenant(context)
    try:
        yield
    finally:
        reset_current_tenant(token)
