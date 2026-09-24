"""Etapas del embudo por negocio: reglas puras y rutas del administrador."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from models.schemas import LeadStageCreate, LeadStagePatch, LeadStageUpdate
from routers import lead_stages as router
from services.lead_stages import (
    InvalidLeadStageError,
    LeadStageInUseError,
    LeadStageProtectedError,
    StageRule,
    _mentions_stage,
    _unique_key,
    require_destination,
    slugify_stage_key,
    update_lead_stage_definition,
)

ADMIN = SimpleNamespace(id=1, role="admin")


@pytest.mark.parametrize(("name", "key"), [
    ("Cita pagada", "cita_pagada"),
    ("  En diagnóstico ", "en_diagnostico"),
    ("Ñandú & Co.", "nandu_co"),
    ("2da visita", "etapa_2da_visita"),
    ("¡¡!!", "etapa"),
])
def test_key_is_a_stable_slug_of_the_name(name, key):
    assert slugify_stage_key(name) == key


def test_key_collisions_get_a_numeric_suffix():
    assert _unique_key("perdido", {"perdido"}) == "perdido_2"
    assert _unique_key("perdido", {"perdido", "perdido_2"}) == "perdido_3"
    long_key = "a" * 40
    assert len(_unique_key(long_key, {long_key})) <= 40


def test_destination_must_exist_and_be_active():
    rules = {
        "nuevo": StageRule("nuevo", "open", True),
        "archivado": StageRule("archivado", "lost", False),
    }
    assert require_destination(rules, "nuevo").kind == "open"
    with pytest.raises(InvalidLeadStageError, match="desactivada"):
        require_destination(rules, "archivado")
    with pytest.raises(InvalidLeadStageError, match="no existe"):
        require_destination(rules, "inventada")


def test_automation_json_references_are_detected():
    """Las tres formas en que una automatización guarda una etapa."""
    assert _mentions_stage({"stage": "agendado", "origin_contains": None}, "agendado")
    assert _mentions_stage([{"type": "change_stage", "stage": "agendado"}], "agendado")
    flow = {"nodes": [{"data": {"condition_groups": [{"conditions": [
        {"condition_type": "stage_equals", "value": "agendado"},
    ]}]}}]}
    assert _mentions_stage(flow, "agendado")
    assert not _mentions_stage(flow, "perdido")
    # Un texto libre que casualmente coincide no cuenta como referencia.
    assert not _mentions_stage({"type": "send_message", "text": "agendado"}, "agendado")


def test_schemas_validate_shape_not_membership():
    # Cualquier clave bien formada es aceptable: si existe lo decide el negocio.
    assert LeadStageUpdate(stage="cita_pagada").stage == "cita_pagada"
    with pytest.raises(ValidationError):
        LeadStageUpdate(stage="Cita Pagada")
    created = LeadStageCreate(name="  Cita  ", color="#0EA5E9")
    assert created.name == "Cita"
    assert created.color == "#0ea5e9"
    assert created.kind == "open"
    with pytest.raises(ValidationError):
        LeadStageCreate(name="Cita", color="azul")
    with pytest.raises(ValidationError):
        LeadStageCreate(name="Cita", color="#0ea5e9", kind="cerrada")


@pytest.mark.asyncio
async def test_initial_stage_cannot_be_turned_off_or_closed():
    with pytest.raises(LeadStageProtectedError):
        await update_lead_stage_definition("nuevo", {"is_active": False})
    with pytest.raises(LeadStageProtectedError):
        await update_lead_stage_definition("nuevo", {"kind": "lost"})


@pytest.mark.asyncio
async def test_create_normalizes_and_broadcasts(monkeypatch):
    create = AsyncMock(return_value={"key": "cita_pagada"})
    broadcast = AsyncMock()
    monkeypatch.setattr(router, "create_lead_stage", create)
    monkeypatch.setattr(router, "manager", SimpleNamespace(broadcast=broadcast))

    await router.post_lead_stage(
        LeadStageCreate(name="Cita   pagada", color="#0ea5e9", description="   "), ADMIN
    )

    values = create.await_args.args[0]
    assert values["name"] == "Cita pagada"
    assert values["description"] is None
    broadcast.assert_awaited_once_with({"type": "lead_stages_updated"})


@pytest.mark.asyncio
async def test_patch_rejects_explicit_nulls(monkeypatch):
    monkeypatch.setattr(router, "update_lead_stage_definition", AsyncMock())
    with pytest.raises(HTTPException) as exc:
        await router.patch_lead_stage("agendado", LeadStagePatch(is_active=None), ADMIN)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_stage_in_use_is_a_conflict_that_suggests_deactivating(monkeypatch):
    monkeypatch.setattr(
        router,
        "delete_lead_stage",
        AsyncMock(side_effect=LeadStageInUseError("La etapa está en uso (3 leads). Desactívala.")),
    )
    with pytest.raises(HTTPException) as exc:
        await router.remove_lead_stage("agendado", ADMIN)
    assert exc.value.status_code == 409
    assert "Desactívala" in exc.value.detail


@pytest.mark.asyncio
async def test_protected_stage_is_a_bad_request(monkeypatch):
    monkeypatch.setattr(
        router,
        "delete_lead_stage",
        AsyncMock(side_effect=LeadStageProtectedError("La etapa inicial no se puede eliminar")),
    )
    with pytest.raises(HTTPException) as exc:
        await router.remove_lead_stage("nuevo", ADMIN)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_moving_a_lead_to_an_unknown_stage_is_422(monkeypatch):
    from routers import chats
    from tests.conftest import patch_chats

    patch_chats(
        monkeypatch,
        "update_lead_stage",
        AsyncMock(side_effect=InvalidLeadStageError("archivado", inactive=True)),
    )
    with pytest.raises(HTTPException) as exc:
        await chats.move_chat_stage("lead-1", LeadStageUpdate(stage="archivado"), ADMIN)
    assert exc.value.status_code == 422
    assert "desactivada" in exc.value.detail


class _StageSession:
    """Sesión mínima que solo responde a load_stage_rules."""

    def __init__(self, rows):
        self.rows = rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False

    async def execute(self, _statement):
        return SimpleNamespace(all=lambda: self.rows, scalars=lambda: SimpleNamespace(all=lambda: []))


def _rule_values(**overrides):
    values = {
        "name": "Mover a cita",
        "trigger_type": "manual",
        "actions": [{"type": "change_stage", "stage": "cita_pagada"}],
    }
    values.update(overrides)
    return values


@pytest.mark.asyncio
async def test_automation_accepts_a_custom_active_stage(monkeypatch):
    from services import automation_service
    from tests.conftest import patch_automations

    rows = [("cita_pagada", "won", True)]
    patch_automations(monkeypatch, "get_sessionmaker", lambda: lambda: _StageSession(rows))

    values = await automation_service.validate_automation_rule(_rule_values())

    assert values["actions"] == [{"type": "change_stage", "stage": "cita_pagada"}]


@pytest.mark.asyncio
async def test_automation_rejects_moving_to_an_inactive_stage(monkeypatch):
    from services import automation_service
    from tests.conftest import patch_automations

    rows = [("cita_pagada", "won", False)]
    patch_automations(monkeypatch, "get_sessionmaker", lambda: lambda: _StageSession(rows))

    with pytest.raises(ValueError, match="desactivada"):
        await automation_service.validate_automation_rule(_rule_values())


@pytest.mark.asyncio
async def test_automation_condition_only_needs_the_stage_to_exist(monkeypatch):
    """Filtrar por una etapa desactivada que todavía tiene leads es válido;
    por una que el negocio no tiene, no."""
    from services import automation_service
    from tests.conftest import patch_automations

    rows = [("nuevo", "open", True), ("archivado", "lost", False)]
    patch_automations(monkeypatch, "get_sessionmaker", lambda: lambda: _StageSession(rows))
    actions = [{"type": "change_stage", "stage": "nuevo"}]

    values = await automation_service.validate_automation_rule(
        _rule_values(actions=actions, conditions={"stage": "archivado"})
    )
    assert values["conditions"]["stage"] == "archivado"

    with pytest.raises(ValueError, match="no existe"):
        await automation_service.validate_automation_rule(
            _rule_values(actions=actions, conditions={"stage": "inventada"})
        )


@pytest.mark.asyncio
async def test_analyst_context_carries_the_business_stages(monkeypatch):
    """El workflow analista es uno solo: las etapas válidas le llegan en el
    contexto del job, no escritas en el prompt."""
    from datetime import datetime, timedelta, timezone
    from uuid import UUID

    from routers import webhooks
    from services.ai_job_tokens import AIJobClaims
    from tests.conftest import patch_webhooks

    job_id = "5e0dd73e-80c7-4a9d-82a9-b4a670c8b90d"
    stages = [{"key": "nuevo", "name": "Nuevo", "kind": "open", "description": None}]
    patch_webhooks(monkeypatch, "start_ai_job", AsyncMock(return_value=SimpleNamespace(context_revision="v1:a")))
    patch_webhooks(monkeypatch, "fetch_analysis_context", AsyncMock(return_value={
        "context_revision": "v1:a", "lead": {"estado": "nuevo"}, "messages": [], "message_cursor": None,
    }))
    patch_webhooks(monkeypatch, "record_ai_job_step", AsyncMock())
    patch_webhooks(monkeypatch, "list_stages_for_ai", AsyncMock(return_value=stages))
    patch_webhooks(monkeypatch, "fetch_tenant_config", AsyncMock(return_value={"moneda": "PEN"}))
    claims = AIJobClaims(
        organization_id=UUID("68b010ae-8f9b-4f47-ab57-c74048923081"),
        job_id=job_id,
        operation="analyst",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )

    context = await webhooks.analysis_context_webhook("lead-1", 500, job_id, claims)

    assert context["stages"] == stages
    assert context["lead"]["estado"] == "nuevo"
    # El prompt del analista también usa el perfil del negocio.
    assert context["tenant_config"] == {"moneda": "PEN"}
