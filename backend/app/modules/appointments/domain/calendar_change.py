"""Cuándo una cita del CRM y su evento de Google Calendar dejaron de decir
lo mismo.

El equipo reprograma o cambia el tratamiento editando el evento en el
calendario (el CRM no edita citas), y la cita se queda con los datos viejos.
El 2026-11-27, de diez citas del CRM con recordatorio, seis tenían en el
calendario un título distinto: tres con otro tratamiento (una paciente
recibió tres recordatorios de "HIFU 12D" por una cita de Botox) y tres con el precio
agregado a mano.

La hora no cuenta: la cita que solo se movió de hora sigue bien, porque el
recordatorio ya lee la fecha del calendario. Lo que se compara es el título
que arma el CRM con la plantilla del negocio contra el que tiene el evento.
"""

from __future__ import annotations

import re

from app.modules.appointments.domain.calendar_event import placeholders

# Un precio escrito a mano en el título, entre paréntesis: "(x 850 soles)",
# "(S/ 300)". No es parte del servicio que se le nombra al paciente.
_PRICE = re.compile(r"\([^()]*\d[^()]*\)")


def _normal(text: str | None) -> str:
    return " ".join((text or "").split()).casefold()


def title_changed(event_summary: str, crm_title: str, confirmed_summary: str | None = None) -> bool:
    """True si el título del evento ya no es el que arma el CRM ni uno que
    el equipo confirmó. Mayúsculas y espacios de más no cuentan; un evento
    sin título tampoco (no hay nada que comparar)."""
    current = _normal(event_summary)
    if not current or current == _normal(crm_title):
        return False
    return current != _normal(confirmed_summary)


def suggested_treatment(event_summary: str, title_template: str) -> str:
    """El servicio que se lee del título del evento, para proponerlo al
    confirmar: lo que va antes del primer separador cuando la plantilla
    empieza por ``{tratamiento}``, sin el precio escrito a mano. Vacío si la
    plantilla no permite leerlo; quien confirma lo escribe."""
    template = " ".join((title_template or "").split())
    if not template.startswith("{tratamiento}"):
        return ""
    rest = template.removeprefix("{tratamiento}")
    keys = placeholders(rest)
    separator = rest.split("{", 1)[0].strip() if keys else ""
    summary = " ".join((event_summary or "").split())
    head = summary.split(separator, 1)[0] if separator else summary
    return " ".join(_PRICE.sub(" ", head).split())
