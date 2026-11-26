"""Paquetes por negocio: qué trae cada uno y dónde se bloquea lo que no trae."""

from __future__ import annotations

import re
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from app.core.errors import Conflict, Forbidden
from app.modules.automations.application import management
from app.modules.platform import entitlements
from app.modules.platform.plans import (
    DEFAULT_PLAN,
    FEATURE_LABELS,
    PLANS,
    Feature,
    PlanId,
    minimum_plan_for,
    plan_spec,
)
from tests.automation_fakes import install_automation_ports

LANDING_PLANS = Path(__file__).resolve().parents[2] / "landing" / "src" / "paquetes.ts"


def use_plan(monkeypatch, plan: PlanId) -> None:
    from app.modules.auth import users_service

    # Quien importa ``current_plan`` por el puerto guarda su propia referencia.
    fake = AsyncMock(return_value=PLANS[plan])
    for module in (entitlements, users_service, management):
        monkeypatch.setattr(module, "current_plan", fake)


class TestCatalog:
    def test_each_plan_includes_everything_of_the_cheaper_one(self):
        basico, esencial, profesional = (PLANS[p] for p in PlanId)
        assert basico.features <= esencial.features <= profesional.features

    def test_every_feature_has_a_label_and_a_plan_that_sells_it(self):
        for feature in Feature:
            assert FEATURE_LABELS[feature]
            assert minimum_plan_for(feature)

    def test_existing_businesses_keep_everything(self):
        # La migración deja a todos en el de por defecto: no puede quitar nada.
        assert DEFAULT_PLAN == PlanId.PROFESIONAL
        assert PLANS[DEFAULT_PLAN].max_seats is None
        assert PLANS[DEFAULT_PLAN].features == frozenset(Feature)

    def test_unknown_value_falls_back_to_the_default(self):
        assert plan_spec("oro").id == DEFAULT_PLAN
        assert plan_spec(None).id == DEFAULT_PLAN

    @pytest.mark.skipif(not LANDING_PLANS.exists(), reason="sin la landing en el checkout")
    def test_landing_promises_the_same_seat_limits(self):
        source = LANDING_PLANS.read_text(encoding="utf-8")
        row = re.search(r'nombre: "Personas que atienden",\s*en: \{([^}]*)\}', source)
        assert row, "la fila de personas de la landing cambió de forma"
        promised = dict(re.findall(r'(\w+): "([^"]+)"', row.group(1)))
        for plan_id, spec in PLANS.items():
            expected = "Sin límite" if spec.max_seats is None else f"Hasta {spec.max_seats}"
            assert promised[plan_id.value] == expected, plan_id


class TestFeatures:
    async def test_missing_feature_says_which_plan_brings_it(self, monkeypatch):
        use_plan(monkeypatch, PlanId.BASICO)
        with pytest.raises(Forbidden) as error:
            await entitlements.ensure_feature(Feature.REPORTS_EXPORT)
        assert error.value.code == "plan_feature_missing"
        assert "Esencial" in error.value.detail

    async def test_included_feature_passes(self, monkeypatch):
        use_plan(monkeypatch, PlanId.ESENCIAL)
        await entitlements.ensure_feature(Feature.CUSTOM_FIELDS)
        with pytest.raises(Forbidden):
            await entitlements.ensure_feature(Feature.META_CONVERSIONS)

    async def test_without_tenant_nothing_is_limited(self):
        # Instalación de un solo negocio: no hay plano de control que limite.
        assert (await entitlements.current_plan()).id == DEFAULT_PLAN

    async def test_route_dependency_blocks(self, monkeypatch):
        use_plan(monkeypatch, PlanId.BASICO)
        dependency = entitlements.require_feature(Feature.ERP_SYNC)
        assert dependency.__feature__ == Feature.ERP_SYNC
        with pytest.raises(Forbidden):
            await dependency()


class TestSeats:
    async def test_full_plan_blocks_one_more_person(self, monkeypatch):
        use_plan(monkeypatch, PlanId.BASICO)
        with pytest.raises(Conflict) as error:
            await entitlements.ensure_seat_available(AsyncMock(return_value=3))
        assert error.value.code == "plan_limit_reached"
        await entitlements.ensure_seat_available(AsyncMock(return_value=2))

    async def test_unlimited_plan_does_not_count(self, monkeypatch):
        use_plan(monkeypatch, PlanId.PROFESIONAL)
        counter = AsyncMock(return_value=999)
        await entitlements.ensure_seat_available(counter)
        counter.assert_not_awaited()

    async def test_read_only_accounts_never_take_a_seat(self, monkeypatch):
        from app.modules.auth import users_service

        use_plan(monkeypatch, PlanId.BASICO)
        counter = AsyncMock(return_value=3)
        monkeypatch.setattr(users_service.users_repository, "count_seats", counter)
        await users_service.ensure_seat_for_invite("contador@example.com", "analista")
        with pytest.raises(Conflict):
            await users_service.ensure_seat_for_invite("nueva@example.com", "vendedor")

    async def test_deactivating_or_demoting_is_never_blocked(self, monkeypatch):
        from types import SimpleNamespace

        from app.modules.auth import users_service

        use_plan(monkeypatch, PlanId.BASICO)
        seller = SimpleNamespace(role="vendedor", is_active=True, activated_at=object())
        monkeypatch.setattr(users_service.users_repository, "get_user_by_id", AsyncMock(return_value=seller))
        counter = AsyncMock(return_value=10)
        monkeypatch.setattr(users_service.users_repository, "count_seats", counter)
        await users_service.ensure_seat_for_update(1, {"is_active": False})
        await users_service.ensure_seat_for_update(1, {"role": "analista"})
        counter.assert_not_awaited()

    async def test_reactivating_takes_a_seat(self, monkeypatch):
        from types import SimpleNamespace

        from app.modules.auth import users_service

        use_plan(monkeypatch, PlanId.BASICO)
        former = SimpleNamespace(role="vendedor", is_active=False, activated_at=object())
        monkeypatch.setattr(users_service.users_repository, "get_user_by_id", AsyncMock(return_value=former))
        monkeypatch.setattr(users_service.users_repository, "count_seats", AsyncMock(return_value=3))
        with pytest.raises(Conflict):
            await users_service.ensure_seat_for_update(1, {"is_active": True})


class TestAutomations:
    def _rules(self, world, *, active: int, inactive: int = 1):
        for index in range(active + inactive):
            world.rules.rules[index + 1] = {
                "id": index + 1, "name": f"Regla {index + 1}", "is_active": index < active,
                "trigger_type": "manual", "trigger_config": {}, "flow_definition": {},
                "published_flow_definition": {"nodes": []}, "flow_version": 1,
            }

    async def test_basic_allows_three_active_at_a_time(self, monkeypatch):
        world = install_automation_ports(monkeypatch)
        use_plan(monkeypatch, PlanId.BASICO)
        self._rules(world, active=3)
        with pytest.raises(Conflict):
            await management.update_automation_rule(4, {"is_active": True})
        assert world.rules.rules[4]["is_active"] is False

    async def test_editing_an_active_rule_does_not_take_another_slot(self, monkeypatch):
        world = install_automation_ports(monkeypatch)
        use_plan(monkeypatch, PlanId.BASICO)
        self._rules(world, active=3)
        await management.update_automation_rule(1, {"is_active": True, "name": "Otra"})
        assert world.rules.rules[1]["name"] == "Otra"

    async def test_turning_off_frees_a_slot(self, monkeypatch):
        world = install_automation_ports(monkeypatch)
        use_plan(monkeypatch, PlanId.BASICO)
        self._rules(world, active=3)
        await management.update_automation_rule(1, {"is_active": False})
        await management.update_automation_rule(4, {"is_active": True})
        assert world.rules.rules[4]["is_active"] is True
