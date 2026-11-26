"""Los recordatorios de cita: cuándo le toca a cada uno y a quién.

Se leen del calendario y no de la tabla de citas: la cita que se movió o se
borró en Google Calendar es la que vale. Un evento creado desde el CRM trae
el id de su cita; uno cargado a mano solo sirve si su texto trae un teléfono.

Cada recordatorio sale una sola vez por evento, anticipación y hora de inicio:
si la cita se mueve, los recordatorios de la hora nueva salen de nuevo.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta

from app.modules.appointments.domain.notice import InvalidNotice

MIN_OFFSET_MINUTES = 15
MAX_OFFSET_MINUTES = 7 * 24 * 60
MAX_REMINDERS = 5
# Lo que pidió el negocio al crear la función: un día, cinco horas y una hora
# antes. Arrancan apagados hasta que cada uno tenga su plantilla.
DEFAULT_OFFSETS = (24 * 60, 5 * 60, 60)

# Cuánto después de su hora todavía sirve un recordatorio. Cubre un worker
# reiniciado o Google lento, pero no manda "falta un día" a una cita que se
# movió a dentro de tres horas: pasado ese margen el recordatorio se saltea.
_MIN_GRACE = timedelta(minutes=10)
_MAX_GRACE = timedelta(hours=6)


@dataclass(frozen=True)
class Reminder:
    offset_minutes: int
    enabled: bool = False
    template_id: int | None = None
    parameters: tuple[str, ...] = field(default_factory=tuple)

    @property
    def offset(self) -> timedelta:
        return timedelta(minutes=self.offset_minutes)

    @property
    def grace(self) -> timedelta:
        return min(max(self.offset / 4, _MIN_GRACE), _MAX_GRACE)


def default_reminders() -> tuple[Reminder, ...]:
    return tuple(Reminder(offset_minutes=offset) for offset in DEFAULT_OFFSETS)


def parse_reminders(raw: str) -> tuple[Reminder, ...]:
    """Lo guardado en los ajustes. Vacío o ilegible: los de por defecto,
    apagados. Mejor no recordar que recordar mal."""
    try:
        items = json.loads(raw) if raw.strip() else None
    except ValueError:
        items = None
    if not isinstance(items, list):
        return default_reminders()
    reminders = []
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            offset = int(item.get("offset_minutes"))
        except (TypeError, ValueError):
            continue
        template_id = item.get("template_id")
        parameters = item.get("parameters") or []
        if not isinstance(parameters, list) or not all(isinstance(value, str) for value in parameters):
            parameters = []
        reminders.append(Reminder(
            offset_minutes=offset,
            enabled=item.get("enabled") is True,
            template_id=template_id if isinstance(template_id, int) and not isinstance(template_id, bool) else None,
            parameters=tuple(parameters),
        ))
    return tuple(reminders)


def dump_reminders(reminders: tuple[Reminder, ...]) -> str:
    return json.dumps([
        {
            "offset_minutes": item.offset_minutes, "enabled": item.enabled,
            "template_id": item.template_id, "parameters": list(item.parameters),
        }
        for item in reminders
    ])


def validate_offsets(reminders: list[Reminder]) -> None:
    """Levanta ``InvalidNotice`` si la lista no se puede guardar."""
    if len(reminders) > MAX_REMINDERS:
        raise InvalidNotice(f"Se pueden configurar hasta {MAX_REMINDERS} recordatorios")
    seen: set[int] = set()
    for item in reminders:
        if not MIN_OFFSET_MINUTES <= item.offset_minutes <= MAX_OFFSET_MINUTES:
            raise InvalidNotice("Cada recordatorio sale entre 15 minutos y 7 días antes de la cita")
        if item.offset_minutes in seen:
            raise InvalidNotice(f"Hay dos recordatorios {describe_offset(item.offset_minutes)} antes")
        seen.add(item.offset_minutes)


def describe_offset(minutes: int) -> str:
    """``1 día``, ``5 horas``, ``1 hora y 30 minutos``: como lo lee el equipo."""
    days, rest = divmod(minutes, 24 * 60)
    hours, mins = divmod(rest, 60)
    parts = []
    if days:
        parts.append(f"{days} día" + ("s" if days != 1 else ""))
    if hours:
        parts.append(f"{hours} hora" + ("s" if hours != 1 else ""))
    if mins:
        parts.append(f"{mins} minuto" + ("s" if mins != 1 else ""))
    if not parts:
        return "0 minutos"
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " y " + parts[-1]


@dataclass(frozen=True)
class CalendarEvent:
    """Un evento de Google Calendar con hora (los de día completo no son
    citas). ``starts_at`` y ``ends_at`` vienen en la zona del negocio."""

    id: str
    starts_at: datetime
    ends_at: datetime
    summary: str = ""
    description: str = ""
    location: str = ""
    created_at: datetime | None = None
    appointment_id: int | None = None

    @property
    def duration_minutes(self) -> int:
        return max(int((self.ends_at - self.starts_at).total_seconds() // 60), 0)


def due_reminders(reminders: tuple[Reminder, ...], event: CalendarEvent, now: datetime) -> list[Reminder]:
    """Los recordatorios que tocan ahora para este evento. Uno toca desde su
    hora hasta que pasa su margen (o empieza la cita), y solo si el evento ya
    existía a esa hora: la cita agendada para dentro de veinte horas no
    recibe el "falta un día" justo después de su aviso de confirmación."""
    due = []
    for reminder in reminders:
        if not reminder.enabled or reminder.template_id is None:
            continue
        at = event.starts_at - reminder.offset
        if not at <= now < min(at + reminder.grace, event.starts_at):
            continue
        if event.created_at is not None and event.created_at > at:
            continue
        due.append(reminder)
    return due


# Un teléfono escrito a mano: "+51 987 654 321", "987-654-321", "(01) 234 5678".
_PHONE = re.compile(r"\+?\d[\d\s().-]{6,18}\d")
# La línea que lo nombra gana sobre cualquier otro número del texto (un DNI,
# un monto): así lo escribe la plantilla del evento del CRM.
_PHONE_LABEL = re.compile(r"(tel[eé]fono|tel\.?|cel(ular)?\.?|whats\s?app|wsp|n[uú]mero|m[oó]vil)\s*:?", re.IGNORECASE)


def extract_phone(*texts: str) -> str | None:
    """El teléfono del evento cargado a mano, tal como se escribió: primero
    el de una línea rotulada (``Teléfono: …``), si no el primer número con
    largo de teléfono. ``None`` si no hay ninguno."""
    candidates: list[str] = []
    for text in texts:
        for line in (text or "").splitlines():
            label = _PHONE_LABEL.search(line)
            if label:
                found = _PHONE.search(line, label.end())
                if found:
                    return found.group(0).strip()
            candidates.extend(match.group(0).strip() for match in _PHONE.finditer(line))
    phones = [value for value in candidates if 8 <= len(re.sub(r"\D", "", value)) <= 15]
    return phones[0] if phones else None


_HOURS = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$")


@dataclass(frozen=True)
class ReminderHours:
    """Las citas que reciben recordatorios, por su hora de inicio en la zona
    del negocio (los dos extremos cuentan). Pensado para el horario de
    atención: un evento a las 21:00 es algo personal del equipo, no una cita,
    y no tiene por qué escribirle a nadie."""

    start: time
    end: time

    def covers(self, starts_at: datetime) -> bool:
        return self.start <= starts_at.time().replace(second=0, microsecond=0) <= self.end

    def to_setting(self) -> str:
        return f"{self.start:%H:%M}-{self.end:%H:%M}"


def parse_hours(raw: str) -> ReminderHours | None:
    """Lo guardado en los ajustes (``09:00-19:00``). Vacío o ilegible: sin
    horario, todas las citas."""
    match = _HOURS.match((raw or "").strip())
    if not match:
        return None
    start = time(int(match.group(1)), int(match.group(2)))
    end = time(int(match.group(3)), int(match.group(4)))
    return ReminderHours(start, end) if start < end else None


def validate_hours(start: str, end: str) -> ReminderHours:
    """Levanta ``InvalidNotice`` si el horario no se puede guardar."""
    hours = parse_hours(f"{start}-{end}")
    if hours is None:
        raise InvalidNotice("El horario de las citas va de una hora a otra más tarde (por ejemplo, de 09:00 a 19:00)")
    return hours
