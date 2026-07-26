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

from db.models import Lead
from models.schemas import Chat, LeadStageUpdate, LeadUpdate
from routers import chats
from services.db_service import _activity_safe


CHAT_ID = "51906471403@s.whatsapp.net"
ADMIN = SimpleNamespace(role="admin", id=1)


@pytest.fixture
def update_deps(monkeypatch):
    updated = AsyncMock(return_value={"chat_id": CHAT_ID})
    monkeypatch.setattr(chats, "update_lead", updated)
    monkeypatch.setattr(chats, "manager", SimpleNamespace(broadcast=AsyncMock()))
    return updated


@pytest.mark.asyncio
async def test_patch_lead_persists_the_four_editable_fields(update_deps):
    body = LeadUpdate(
        con_especialista=True,
        razon_perdido="Se fue con la competencia",
        fecha_recontacto="2026-08-01",
        proxima_cita="2026-08-01T15:00:00Z",
    )

    await chats.update_chat(CHAT_ID, body, ADMIN)

    values = update_deps.await_args.args[1]
    assert values["con_especialista"] is True
    assert values["razon_perdido"] == "Se fue con la competencia"
    # Pydantic ya los entrega tipados: asyncpg necesita los objetos, no strings.
    assert values["fecha_recontacto"] == date(2026, 8, 1)
    assert values["proxima_cita"] == datetime(2026, 8, 1, 15, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_patch_lead_ignores_fields_not_sent(update_deps):
    """exclude_unset: tocar el nombre no puede borrar la próxima cita."""
    await chats.update_chat(CHAT_ID, LeadUpdate(name="Ana"), ADMIN)

    values = update_deps.await_args.args[1]
    assert set(values) == {"nombre"}


@pytest.fixture
def stage_deps(monkeypatch):
    update_stage = AsyncMock(return_value={"chat_id": CHAT_ID, "stage": "perdido"})
    monkeypatch.setattr(chats, "fetch_chat", AsyncMock(return_value={"stage": "calificado"}))
    monkeypatch.setattr(chats, "update_lead_stage", update_stage)
    monkeypatch.setattr(chats, "manager", SimpleNamespace(broadcast=AsyncMock()))
    monkeypatch.setattr(chats, "trigger_stage_changed", AsyncMock())
    return update_stage


@pytest.mark.asyncio
async def test_move_to_lost_forwards_the_reason(stage_deps):
    body = LeadStageUpdate(stage="perdido", razon_perdido="No contesta hace un mes")

    await chats.move_chat_stage(CHAT_ID, body, ADMIN)

    assert stage_deps.await_args.kwargs["razon_perdido"] == "No contesta hace un mes"


@pytest.mark.asyncio
async def test_move_without_reason_is_allowed(stage_deps):
    """Los webhooks y las automatizaciones mueven a perdido sin razón: exigirla
    en el backend los rompería."""
    await chats.move_chat_stage(CHAT_ID, LeadStageUpdate(stage="perdido"), ADMIN)

    assert stage_deps.await_args.kwargs["razon_perdido"] is None


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
    """_LEAD_FIELD_TO_COLUMN es el único gate del PATCH: un typo acá sería un
    AttributeError recién dentro de update_lead."""
    for column in chats._LEAD_FIELD_TO_COLUMN.values():
        assert hasattr(Lead, column), f"Lead.{column} no existe"
