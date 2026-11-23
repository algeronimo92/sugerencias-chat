"""El horario de atención del negocio: qué días atiende y de qué hora a qué hora.

Hasta el 2026-11-23 era una constante del motor de automatizaciones (lunes a
viernes, 08:00–18:00, hora de Lima) igual para todos los negocios. DermicaPro
atiende los sábados, su día de más movimiento, y las automatizaciones con
«solo en horario laboral» los descartaban como fuera de horario.

Se guarda en el ajuste ``business_hours`` como JSON
``{"0": ["08:00", "18:00"], ...}`` (0 = lunes; un día ausente está cerrado).
Vacío significa que nadie lo configuró: vale el horario de siempre, para que
ningún negocio cambie de comportamiento sin haberlo decidido.

Un solo tramo por día: partirlo (almuerzo) o tener uno por vendedora no se
pidió y complicaría la pantalla sin un caso real detrás.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, time, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.modules.platform.settings_service import get_effective_many

BUSINESS_HOURS_KEY = "business_hours"
DEFAULT_TIMEZONE = "America/Lima"
DEFAULT_DAYS: dict[int, tuple[time, time]] = {day: (time(8), time(18)) for day in range(5)}

_DAY_NAMES = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")


@dataclass(frozen=True)
class BusinessHours:
    timezone: tzinfo
    days: dict[int, tuple[time, time]]

    def contains(self, moment: datetime) -> bool:
        """¿El negocio está atendiendo en ese instante? El fin es exclusivo:
        a las 18:00 en punto ya cerró."""
        local = moment.astimezone(self.timezone)
        hours = self.days.get(local.weekday())
        if hours is None:
            return False
        start, end = hours
        return start <= local.time().replace(tzinfo=None) < end

    def describe(self) -> str:
        """«lunes a viernes 08:00–18:00; sábado 09:00–14:00», para el motivo
        que queda en el historial."""
        if not self.days:
            return "sin días de atención"
        groups: list[tuple[int, int, tuple[time, time]]] = []
        for day in sorted(self.days):
            hours = self.days[day]
            if groups and groups[-1][1] == day - 1 and groups[-1][2] == hours:
                groups[-1] = (groups[-1][0], day, hours)
            else:
                groups.append((day, day, hours))
        return "; ".join(
            f"{_DAY_NAMES[first] if first == last else f'{_DAY_NAMES[first]} a {_DAY_NAMES[last]}'} "
            f"{hours[0]:%H:%M}–{hours[1]:%H:%M}"
            for first, last, hours in groups
        )


def _parse_time(value: object) -> time:
    if not isinstance(value, str):
        raise ValueError("La hora debe tener el formato HH:MM")
    try:
        parsed = time.fromisoformat(value.strip())
    except ValueError as exc:
        raise ValueError("La hora debe tener el formato HH:MM") from exc
    return parsed.replace(second=0, microsecond=0, tzinfo=None)


def parse_days(raw: object) -> dict[int, tuple[time, time]]:
    """Valida el horario semanal y lo devuelve por día. Levanta ValueError con
    un mensaje para la persona que lo está configurando."""
    if not isinstance(raw, dict):
        raise ValueError("El horario de atención no es válido")
    days: dict[int, tuple[time, time]] = {}
    for key, hours in raw.items():
        try:
            day = int(key)
        except (TypeError, ValueError) as exc:
            raise ValueError("El horario de atención no es válido") from exc
        if day not in range(7) or not isinstance(hours, (list, tuple)) or len(hours) != 2:
            raise ValueError("El horario de atención no es válido")
        start, end = _parse_time(hours[0]), _parse_time(hours[1])
        if start >= end:
            raise ValueError(f"El {_DAY_NAMES[day]} la hora de cierre debe ser posterior a la de apertura")
        days[day] = (start, end)
    return days


def serialize_days(days: dict[int, tuple[time, time]]) -> str:
    return json.dumps(
        {str(day): [f"{start:%H:%M}", f"{end:%H:%M}"] for day, (start, end) in sorted(days.items())},
        separators=(",", ":"),
    )


def days_from_setting(value: str) -> dict[int, tuple[time, time]]:
    """Lo guardado, o el horario de siempre si está vacío o ilegible: un
    ajuste corrupto no puede dejar las automatizaciones sin horario."""
    if not value.strip():
        return dict(DEFAULT_DAYS)
    try:
        return parse_days(json.loads(value))
    except ValueError:
        return dict(DEFAULT_DAYS)


def _timezone(name: str) -> tzinfo:
    try:
        return ZoneInfo(name.strip() or DEFAULT_TIMEZONE)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TIMEZONE)


async def business_hours() -> BusinessHours:
    """El horario del negocio activo, en su zona horaria (la misma que usa
    para las citas)."""
    values = await get_effective_many((BUSINESS_HOURS_KEY, "business_timezone"))
    return BusinessHours(
        timezone=_timezone(values["business_timezone"]),
        days=days_from_setting(values[BUSINESS_HOURS_KEY]),
    )
