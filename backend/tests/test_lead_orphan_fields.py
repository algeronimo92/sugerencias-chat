"""Campos de leads que hasta ahora solo existían como columna: los cuatro que
el asesor edita (con_especialista, razon_perdido, fecha_recontacto,
proxima_cita) y la razón que se pide al mover un lead a `perdido`.

Sin PostgreSQL: se ejercita el router con dobles y la serialización a JSONB
como unidad aparte.
"""

from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.db.models.leads import Lead
from app.modules.leads.schemas import Chat, LeadStageUpdate, LeadUpdate
from app.modules.leads import api as chats
from app.modules.leads.domain.lead import audit_safe as _activity_safe
from app.modules.leads.updates import LEAD_FIELD_TO_COLUMN


CHAT_ID = "ade6fb90-6b65-5edd-8d8a-8ff1cf733e69"
ADMIN = SimpleNamespace(role="admin", id=1)


@pytest.fixture
def leads_api(in_memory_leads, monkeypatch):
    """La API real sobre los comandos reales, con el repositorio en memoria."""
    in_memory_leads.repository.seed(CHAT_ID, stage="calificado")
    monkeypatch.setattr(chats, "fetch_chat", AsyncMock(return_value={"chat_id": CHAT_ID}))
    return in_memory_leads.repository


@pytest.mark.asyncio
async def test_patch_lead_persists_the_four_editable_fields(leads_api):
    body = LeadUpdate(
        con_especialista=True,
        razon_perdido="Se fue con la competencia",
        fecha_recontacto="2026-08-01",
        proxima_cita="2026-08-01T15:00:00Z",
    )

    await chats.update_chat(CHAT_ID, body, ADMIN)

    assert leads_api.column(CHAT_ID, "con_especialista") is True
    assert leads_api.column(CHAT_ID, "razon_perdido") == "Se fue con la competencia"
    # Pydantic ya los entrega tipados: asyncpg necesita los objetos, no strings.
    assert leads_api.column(CHAT_ID, "fecha_recontacto") == date(2026, 8, 1)
    assert leads_api.column(CHAT_ID, "proxima_cita") == datetime(2026, 8, 1, 15, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_patch_lead_ignores_fields_not_sent(leads_api):
    """exclude_unset: tocar el nombre no puede borrar la próxima cita."""
    await chats.update_chat(CHAT_ID, LeadUpdate(name="Ana"), ADMIN)

    [record] = leads_api.audit(CHAT_ID)
    assert set(record.new_value) == {"nombre"}


@pytest.mark.asyncio
async def test_move_to_lost_forwards_the_reason(leads_api):
    body = LeadStageUpdate(stage="perdido", razon_perdido="No contesta hace un mes")

    await chats.move_chat_stage(CHAT_ID, body, ADMIN)

    assert leads_api.column(CHAT_ID, "razon_perdido") == "No contesta hace un mes"


@pytest.mark.asyncio
async def test_move_without_reason_is_allowed(leads_api):
    """Los webhooks y las automatizaciones mueven a perdido sin razón: exigirla
    en el backend los rompería."""
    await chats.move_chat_stage(CHAT_ID, LeadStageUpdate(stage="perdido"), ADMIN)

    assert leads_api.column(CHAT_ID, "estado") == "perdido"
    assert leads_api.column(CHAT_ID, "razon_perdido") is None


def test_activity_safe_serializes_dates_for_jsonb():
    """old_value/new_value son JSONB: un date crudo revienta el json.dumps."""
    result = _activity_safe(
        {
            "fecha_recontacto": date(2026, 8, 1),
            "proxima_cita": datetime(2026, 8, 1, 15, 0, tzinfo=timezone.utc),
            "con_especialista": True,
            "razon_perdido": None,
        }
    )

    assert result["fecha_recontacto"] == "2026-08-01"
    assert result["proxima_cita"].startswith("2026-08-01T15:00:00")
    assert result["con_especialista"] is True
    assert result["razon_perdido"] is None


def test_chat_schema_exposes_the_orphan_fields():
    """El DTO es lo único que el frontend ve: si un campo no está acá, la ficha
    no puede mostrarlo por más que la columna exista."""
    for field in (
        "username",
        "con_especialista",
        "razon_perdido",
        "fecha_recontacto",
        "proxima_cita",
        "contador_noshow",
        "toques_seguimiento",
        "fecha_ultimo_toque",
    ):
        assert field in Chat.model_fields


def test_editable_fields_map_to_real_columns():
    """LEAD_FIELD_TO_COLUMN es el único gate del PATCH: un typo acá sería un
    AttributeError recién dentro de update_lead."""
    for column in LEAD_FIELD_TO_COLUMN.values():
        assert hasattr(Lead, column), f"Lead.{column} no existe"
