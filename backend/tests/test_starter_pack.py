"""Paquete inicial "Clínica estética" y checklist de primeros pasos, con dobles."""

from __future__ import annotations

from uuid import UUID

import pytest

import app.tenancy.provisioning as provisioning
from app.modules.automations.domain.validation import normalize_rule
from app.modules.catalogs.template_validation import validate_template_values
from app.modules.platform import onboarding, starter_pack
from app.tenancy.context import TenantContext, get_current_tenant


CONTEXT = TenantContext(
    UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
    "tenant_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "b.example.com",
)


# --- Contenido ---------------------------------------------------------------

@pytest.mark.parametrize("template", starter_pack.STARTER_TEMPLATES, ids=lambda t: t["shortcut"])
async def test_every_starter_template_passes_the_form_validation(template) -> None:
    values = {
        **template,
        "template_type": "internal",
        "interactive_type": "none",
        "interactive_config": {},
    }
    normalized = await validate_template_values(values)
    # El atajo es lo que el vendedor escribe tras "/": ya viene normalizado.
    assert normalized["shortcut"] == template["shortcut"]
    assert template["category"] in starter_pack.STARTER_TEMPLATE_CATEGORIES


def test_starter_shortcuts_are_unique() -> None:
    shortcuts = [template["shortcut"] for template in starter_pack.STARTER_TEMPLATES]
    assert len(shortcuts) == len(set(shortcuts))


@pytest.mark.parametrize("rule", starter_pack.STARTER_AUTOMATIONS, ids=lambda r: r["name"])
def test_every_starter_automation_is_valid_and_born_inactive(rule) -> None:
    normalized, refs = normalize_rule(dict(rule))
    assert normalized["is_active"] is False
    # Sin ids que dependan de lo que tenga cada negocio.
    assert not (refs.users or refs.tags or refs.templates or refs.media_assets)


def test_starter_automations_cover_welcome_appointment_and_recovery() -> None:
    triggers = {rule["trigger_type"] for rule in starter_pack.STARTER_AUTOMATIONS}
    assert triggers == {"lead_created", "stage_changed", "customer_response_overdue"}


def test_starter_text_has_no_emojis() -> None:
    texts = [t["content"] for t in starter_pack.STARTER_TEMPLATES] + [
        action.get("text") or action.get("title") or ""
        for rule in starter_pack.STARTER_AUTOMATIONS
        for action in rule["actions"]
    ]
    assert all(ord(char) < 0x2000 for text in texts for char in text)


# --- Aplicación --------------------------------------------------------------

def _fake_pack(monkeypatch, *, admin_id: int | None, existing_rules: list[str]):
    calls: dict[str, list] = {"catalog": [], "created": []}

    async def team():
        return {"users": 1, "first_admin_id": admin_id}

    async def seed_catalog(**kwargs):
        calls["catalog"].append(kwargs)
        return {"tags": len(kwargs["tags"]), "categories": 0, "templates": 0}

    async def rules():
        return [{"name": name} for name in existing_rules]

    async def validate(values):
        return values

    async def create(values, user_id):
        calls["created"].append((values["name"], user_id))
        return {"id": len(calls["created"])}

    monkeypatch.setattr(starter_pack, "team_summary", team)
    monkeypatch.setattr(starter_pack, "seed_starter_catalog", seed_catalog)
    monkeypatch.setattr(starter_pack, "list_automation_rules", rules)
    monkeypatch.setattr(starter_pack, "validate_automation_rule", validate)
    monkeypatch.setattr(starter_pack, "create_automation_rule", create)
    return calls


async def test_apply_creates_only_the_automations_the_business_lacks(monkeypatch) -> None:
    calls = _fake_pack(monkeypatch, admin_id=7, existing_rules=["  bienvenida A LEADS nuevos "])

    result = await starter_pack.apply_starter_pack()

    assert calls["catalog"][0]["user_id"] == 7
    assert [name for name, _ in calls["created"]] == [
        "Recordatorio de cita",
        "Recuperar a quien no responde",
    ]
    assert all(user_id == 7 for _, user_id in calls["created"])
    assert result["automations"] == 2
    assert result["needs_admin"] == 0


async def test_apply_without_admin_seeds_catalog_but_no_rules(monkeypatch) -> None:
    calls = _fake_pack(monkeypatch, admin_id=None, existing_rules=[])

    result = await starter_pack.apply_starter_pack()

    assert calls["catalog"][0]["user_id"] is None
    assert calls["created"] == []
    assert result["automations"] == 0
    assert result["needs_admin"] == 1


# --- Alta del negocio --------------------------------------------------------

def _fake_provisioning(monkeypatch, *, first_activation: bool):
    events: list = []

    async def prepare(**kwargs):
        return CONTEXT, False

    async def step(name):
        events.append(name)

    async def migrate(context):
        await step("migrate")

    async def initialize(context, **kwargs):
        await step("initialize")

    async def activate(context):
        await step("activate")

    async def first(context):
        return first_activation

    monkeypatch.setattr(provisioning, "_prepare_control_records", prepare)
    monkeypatch.setattr(provisioning, "_migrate_schema", migrate)
    monkeypatch.setattr(provisioning, "_initialize_tenant", initialize)
    monkeypatch.setattr(provisioning, "_mark_active", activate)
    monkeypatch.setattr(provisioning, "_is_first_activation", first)
    return events


async def test_new_business_gets_the_pack_inside_its_tenant_before_activation(monkeypatch) -> None:
    events = _fake_provisioning(monkeypatch, first_activation=True)

    async def pack():
        events.append(("pack", get_current_tenant()))

    await provisioning.provision_tenant(name="B", hostname="b.example.com", starter_pack=pack)

    assert events == ["migrate", "initialize", ("pack", CONTEXT), "activate"]


async def test_business_that_already_operated_never_gets_the_pack(monkeypatch) -> None:
    events = _fake_provisioning(monkeypatch, first_activation=False)

    async def pack():
        raise AssertionError("un negocio existente no recibe el paquete")

    await provisioning.provision_tenant(name="B", hostname="b.example.com", starter_pack=pack)

    assert events == ["migrate", "initialize", "activate"]


async def test_a_failing_pack_does_not_block_the_activation(monkeypatch) -> None:
    events = _fake_provisioning(monkeypatch, first_activation=True)

    async def pack():
        raise RuntimeError("boom")

    await provisioning.provision_tenant(name="B", hostname="b.example.com", starter_pack=pack)

    assert events[-1] == "activate"


# --- Checklist ---------------------------------------------------------------

def _fake_onboarding(monkeypatch, *, settings: dict[str, str], users: int, priced: int, customized: bool):
    async def effective(keys):
        return {key: settings.get(key, "") for key in keys}

    async def team():
        return {"users": users, "first_admin_id": 1}

    async def catalog(shortcuts):
        assert shortcuts == starter_pack.STARTER_SHORTCUTS
        return {"priced_services": priced, "templates_customized": customized}

    monkeypatch.setattr(onboarding, "get_effective_many", effective)
    monkeypatch.setattr(onboarding, "team_summary", team)
    monkeypatch.setattr(onboarding, "onboarding_catalog_status", catalog)


async def test_fresh_business_has_every_step_pending(monkeypatch) -> None:
    _fake_onboarding(monkeypatch, settings={}, users=1, priced=0, customized=False)

    status = await onboarding.onboarding_status()

    assert [(s["key"], s["done"]) for s in status["steps"]] == [
        ("whatsapp", False), ("team", False), ("services", False),
        ("google_calendar", False), ("templates", False),
    ]
    assert (status["completed"], status["total"], status["all_done"], status["dismissed"]) == (0, 4, False, False)


async def test_steps_come_from_real_data_and_templates_are_optional(monkeypatch) -> None:
    _fake_onboarding(
        monkeypatch,
        settings={
            "meta_access_token": "t", "meta_phone_number_id": "1", "meta_waba_id": "2",
            "google_calendar_refresh_token": "r",
        },
        users=3, priced=2, customized=False,
    )

    status = await onboarding.onboarding_status()

    assert status["completed"] == status["total"] == 4
    assert status["all_done"] is True
    assert next(s for s in status["steps"] if s["key"] == "templates")["optional"] is True


async def test_whatsapp_needs_the_three_meta_values(monkeypatch) -> None:
    _fake_onboarding(
        monkeypatch, settings={"meta_access_token": "t", "meta_phone_number_id": "1"},
        users=1, priced=0, customized=False,
    )

    status = await onboarding.onboarding_status()

    assert status["steps"][0] == {"key": "whatsapp", "done": False, "optional": False}


async def test_dismiss_is_stored_as_a_business_setting(monkeypatch) -> None:
    stored: dict[str, str] = {}
    _fake_onboarding(monkeypatch, settings=stored, users=1, priced=0, customized=False)

    async def update(values):
        stored.update(values)

    monkeypatch.setattr(onboarding, "update_settings", update)

    status = await onboarding.dismiss_onboarding()

    assert stored == {"onboarding_checklist_dismissed": "true"}
    assert status["dismissed"] is True


async def test_restore_shows_the_checklist_again(monkeypatch) -> None:
    stored: dict[str, str] = {"onboarding_checklist_dismissed": "true"}
    _fake_onboarding(monkeypatch, settings=stored, users=1, priced=0, customized=False)

    async def update(values):
        stored.update(values)

    monkeypatch.setattr(onboarding, "update_settings", update)

    status = await onboarding.restore_onboarding()

    assert stored == {"onboarding_checklist_dismissed": "false"}
    assert status["dismissed"] is False


def test_dismiss_key_is_a_known_hidden_setting() -> None:
    from app.modules.platform.settings_service import SETTING_DEFS

    definition = next(d for d in SETTING_DEFS if d.key == onboarding.DISMISSED_KEY)
    assert definition.hidden and definition.boolean and not definition.secret
