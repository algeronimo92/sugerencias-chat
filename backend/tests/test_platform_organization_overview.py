"""Resumen de un negocio en el panel de plataforma.

El operador lo abre desde el host de plataforma, donde no hay negocio resuelto:
lo que importa es que la lectura entre al schema del negocio pedido y no a otro.
"""

from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.modules.platform import api as platform
from app.modules.platform import platform_organizations
from app.tenancy.context import TenantContext, get_current_tenant

ORG_ID = UUID("68b010ae-8f9b-4f47-ab57-c74048923081")
CONTEXT = TenantContext(ORG_ID, f"tenant_{ORG_ID.hex}", "negocio.example.com")
SETUP = {
    "steps": [{"key": "whatsapp", "done": True, "optional": False}],
    "completed": 1,
    "total": 4,
    "all_done": False,
    "dismissed": False,
}


async def test_overview_reads_inside_the_schema_of_the_requested_business(monkeypatch):
    seen: list[TenantContext | None] = []

    async def setup():
        seen.append(get_current_tenant())
        return SETUP

    async def team():
        seen.append(get_current_tenant())
        return {"users": 3, "first_admin_id": 1}

    monkeypatch.setattr(platform_organizations, "organization_context", AsyncMock(return_value=CONTEXT))
    monkeypatch.setattr(platform_organizations, "onboarding_status", setup)
    monkeypatch.setattr(platform_organizations, "team_summary", team)

    overview = await platform_organizations.organization_overview(ORG_ID)

    assert overview == {"users": 3, "setup": SETUP}
    assert seen == [CONTEXT, CONTEXT]
    # Al salir no queda ningún negocio activo en el host de plataforma.
    assert get_current_tenant() is None


async def test_overview_of_a_missing_business_is_a_404(monkeypatch):
    monkeypatch.setattr(
        platform,
        "organization_overview",
        AsyncMock(side_effect=platform_organizations.OrganizationNotFoundError("x")),
    )

    with pytest.raises(HTTPException) as exc:
        await platform.get_organization_overview(ORG_ID)

    assert exc.value.status_code == 404
