"""El horario de atención de cada negocio. Era una constante del motor de
automatizaciones (lunes a viernes 08:00–18:00, Lima): DermicaPro atiende los
sábados y 63 ejecuciones se descartaron como «fuera de horario»."""

import dataclasses
from datetime import datetime, time, timezone
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import pytest

from app.modules.automations.application.conditions import matches_condition_node, matches_condition_values
from app.modules.platform import business_hours as module
from app.modules.platform.business_hours import (
    DEFAULT_DAYS,
    BusinessHours,
    business_hours,
    days_from_setting,
    parse_days,
    serialize_days,
)
from tests.conftest import make_chat

LIMA = ZoneInfo("America/Lima")
WEEKDAYS = BusinessHours(timezone=LIMA, days=dict(DEFAULT_DAYS))
WITH_SATURDAY = BusinessHours(timezone=LIMA, days={**DEFAULT_DAYS, 5: (time(9), time(14))})


class TestContains:
    @pytest.mark.parametrize(("hour", "expected"), [(7, False), (8, True), (17, True), (18, False)])
    def test_the_closing_hour_is_already_closed(self, hour, expected):
        # 2026-07-20 es lunes.
        assert WEEKDAYS.contains(datetime(2026, 7, 20, hour, tzinfo=LIMA)) is expected

    def test_a_day_without_hours_is_closed(self):
        saturday = datetime(2026, 7, 25, 10, tzinfo=LIMA)
        assert not WEEKDAYS.contains(saturday)
        assert WITH_SATURDAY.contains(saturday)
        assert not WITH_SATURDAY.contains(saturday.replace(hour=15))

    def test_the_moment_is_read_in_the_business_timezone(self):
        # 14:00 UTC del lunes: 09:00 en Lima (abierto) y 23:00 en Tokio (cerrado).
        moment = datetime(2026, 7, 20, 14, tzinfo=timezone.utc)
        assert WEEKDAYS.contains(moment)
        assert not dataclasses.replace(WEEKDAYS, timezone=ZoneInfo("Asia/Tokyo")).contains(moment)


class TestDescribe:
    def test_groups_consecutive_days_with_the_same_hours(self):
        assert WEEKDAYS.describe() == "lunes a viernes 08:00–18:00"
        assert WITH_SATURDAY.describe() == "lunes a viernes 08:00–18:00; sábado 09:00–14:00"

    def test_no_days(self):
        assert BusinessHours(timezone=LIMA, days={}).describe() == "sin días de atención"


class TestParse:
    def test_round_trip(self):
        days = parse_days({"0": ["09:00", "19:30"], "5": ["09:00", "14:00"]})
        assert days == {0: (time(9), time(19, 30)), 5: (time(9), time(14))}
        assert parse_days(__import__("json").loads(serialize_days(days))) == days

    @pytest.mark.parametrize("raw", [
        [],
        {"7": ["08:00", "18:00"]},
        {"lunes": ["08:00", "18:00"]},
        {"0": ["08:00"]},
        {"0": ["8 am", "18:00"]},
    ])
    def test_rejects_malformed_schedules(self, raw):
        with pytest.raises(ValueError):
            parse_days(raw)

    def test_closing_must_come_after_opening(self):
        with pytest.raises(ValueError, match="lunes"):
            parse_days({"0": ["18:00", "08:00"]})

    @pytest.mark.parametrize("stored", ["", "   ", "no es json", '{"9": ["08:00", "18:00"]}'])
    def test_an_empty_or_broken_setting_falls_back_to_the_old_hours(self, stored):
        assert days_from_setting(stored) == DEFAULT_DAYS

    def test_no_open_days_is_a_valid_choice_not_a_missing_setting(self):
        assert days_from_setting("{}") == {}


async def test_loads_the_schedule_and_timezone_of_the_business(monkeypatch):
    monkeypatch.setattr(module, "get_effective_many", AsyncMock(return_value={
        "business_hours": '{"5":["09:00","14:00"]}', "business_timezone": "America/Bogota",
    }))

    hours = await business_hours()

    assert hours.days == {5: (time(9), time(14))}
    assert hours.timezone == ZoneInfo("America/Bogota")


async def test_an_unknown_timezone_falls_back_to_lima(monkeypatch):
    monkeypatch.setattr(module, "get_effective_many", AsyncMock(return_value={
        "business_hours": "", "business_timezone": "America/No_Existe",
    }))

    assert (await business_hours()).timezone == LIMA


def _deps_at(deps, moment, hours):
    async def load():
        return hours

    return dataclasses.replace(deps, now=lambda: moment, business_hours=load)


SATURDAY_MORNING = datetime(2026, 7, 25, 10, tzinfo=LIMA)


class TestAutomationsUseTheBusinessSchedule:
    async def test_entry_condition_passes_on_a_saturday_the_business_works(self, deps):
        conditions = {"business_hours_only": True}

        closed = await matches_condition_values(conditions, make_chat(), 1, _deps_at(deps, SATURDAY_MORNING, WEEKDAYS))
        opened = await matches_condition_values(conditions, make_chat(), 1, _deps_at(deps, SATURDAY_MORNING, WITH_SATURDAY))

        # El motivo dice el horario real, no uno fijo que puede no ser el del negocio.
        assert closed == (False, "Fuera del horario de atención (lunes a viernes 08:00–18:00)")
        assert opened == (True, None)

    async def test_condition_block_follows_the_business_schedule(self, deps):
        data = {"condition_type": "business_hours"}

        closed = await matches_condition_node(data, make_chat(), _deps_at(deps, SATURDAY_MORNING, WEEKDAYS))
        opened = await matches_condition_node(data, make_chat(), _deps_at(deps, SATURDAY_MORNING, WITH_SATURDAY))

        assert closed[:2] == (False, "no")
        assert opened[:2] == (True, "yes")


class TestSettingsRoute:
    @pytest.fixture
    def stored(self, monkeypatch):
        from app.modules.platform import settings_api

        values = {"business_hours": "", "business_timezone": ""}

        async def read(keys):
            return {key: values[key] for key in keys}

        async def write(new):
            values.update(new)

        monkeypatch.setattr(settings_api, "get_effective_many", read)
        monkeypatch.setattr(settings_api, "update_settings", write)
        return values

    async def test_an_unconfigured_business_sees_the_old_hours(self, stored):
        from app.modules.platform.settings_api import get_business_hours

        out = await get_business_hours()

        assert out["configured"] is False
        assert out["timezone"] == "America/Lima"
        assert [day["open"] for day in out["days"]] == [True] * 5 + [False] * 2
        assert out["days"][0] == {"weekday": 0, "open": True, "start": "08:00", "end": "18:00"}

    async def test_saving_keeps_only_the_open_days(self, stored):
        from app.modules.platform.schemas import UpdateBusinessHoursRequest
        from app.modules.platform.settings_api import put_business_hours

        body = UpdateBusinessHoursRequest(days=[
            {"weekday": day, "open": day in (0, 5), "start": "09:00", "end": "14:00"} for day in range(7)
        ])

        out = await put_business_hours(body)

        assert stored["business_hours"] == '{"0":["09:00","14:00"],"5":["09:00","14:00"]}'
        assert out["configured"] is True
        assert [day["weekday"] for day in out["days"] if day["open"]] == [0, 5]

    async def test_rejects_a_day_that_closes_before_it_opens(self, stored):
        from fastapi import HTTPException

        from app.modules.platform.schemas import UpdateBusinessHoursRequest
        from app.modules.platform.settings_api import put_business_hours

        body = UpdateBusinessHoursRequest(days=[
            {"weekday": day, "open": True, "start": "18:00", "end": "09:00"} for day in range(7)
        ])

        with pytest.raises(HTTPException) as error:
            await put_business_hours(body)

        assert error.value.status_code == 422
        assert stored["business_hours"] == ""
