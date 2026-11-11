"""A qué horas de la semana se mueve el negocio: cuándo llegan conversaciones
nuevas, cuántas siguen después de la primera respuesta, cuándo salen flujos y cuándo
escribe el equipo en el CRM.

Va por día de la semana y franja horaria, no por fecha: 30 días por 24 horas
son 720 celdas que nadie lee, y la decisión que alimenta (turnos, a qué hora
pautar) es sobre el patrón de la semana. Se sirven conteos crudos junto con
cuántas veces cayó cada día de la semana en el período; el promedio y el
porcentaje los calcula quien dibuja, para que un período con cinco lunes y
cuatro martes no haga ver al lunes más cargado de lo que es.
"""

import asyncio
from datetime import timedelta

from app.modules.leads.dashboard import activity_queries as activity, automations_queries as automations
from app.modules.leads.dashboard.scope import SLOT_HOURS, SLOTS_PER_DAY, DashboardScope, execute_mapping


def _weekday_occurrences(scope: DashboardScope) -> list[int]:
    """Cuántos lunes, martes… tiene el período (índice 0 = lunes)."""
    occurrences = [0] * 7
    for offset in range(scope.days):
        occurrences[(scope.start_date + timedelta(days=offset)).weekday()] += 1
    return occurrences


def _person_peak(rows, field: str, occurrences: list[int]) -> float:
    """La franja más cargada de la persona más activa, en promedio por día de
    la semana: la misma unidad con que se dibuja cada celda."""
    peak = 0.0
    for row in rows:
        weekday = int(row["weekday"]) - 1
        if 0 <= weekday < 7 and occurrences[weekday] > 0:
            peak = max(peak, int(row[field] or 0) / occurrences[weekday])
    return peak


CELL_FIELDS = ("conversations", "settled", "engaged", "flows_manual", "flows_automatic", "messages", "phone_messages")


async def collect(scope: DashboardScope) -> dict:
    (
        conversations, flows, messages, phone, messages_by_author, flows_by_starter, phone_by_owner,
    ) = await asyncio.gather(
        execute_mapping(activity.conversations_by_hour_stmt(scope)),
        execute_mapping(automations.by_hour_stmt(scope)),
        execute_mapping(activity.messages_by_hour_stmt(scope)),
        execute_mapping(activity.phone_by_hour_stmt(scope)),
        execute_mapping(activity.messages_by_author_hour_stmt(scope)),
        execute_mapping(automations.manual_by_starter_hour_stmt(scope)),
        execute_mapping(activity.phone_by_owner_hour_stmt(scope)),
    )
    occurrences = _weekday_occurrences(scope)
    cells: dict[tuple[int, int], dict] = {}
    for row in (*conversations, *flows, *messages, *phone):
        weekday, slot = int(row["weekday"]) - 1, int(row["slot"])
        if not (0 <= weekday < 7 and 0 <= slot < SLOTS_PER_DAY):
            continue
        cell = cells.setdefault(
            (weekday, slot), {"weekday": weekday, "slot": slot, **dict.fromkeys(CELL_FIELDS, 0)}
        )
        for field in CELL_FIELDS:
            if field in row:
                cell[field] += int(row[field] or 0)
    return {
        "slot_hours": SLOT_HOURS,
        "engagement_window_hours": int(activity.ENGAGEMENT_WINDOW.total_seconds() // 3600),
        "weekday_occurrences": occurrences,
        # Tope común para pintar el mapa de una persona. Sin él cada mapa se
        # pinta contra su propio máximo y dos personas que escriben cantidades
        # muy distintas se ven igual de intensas. Va también en el scope
        # propio: quien mira lo suyo lo ve en la escala del equipo.
        "person_peaks": {
            "messages": _person_peak(messages_by_author, "messages", occurrences),
            "flows_manual": _person_peak(flows_by_starter, "flows_manual", occurrences),
            "phone_messages": _person_peak(phone_by_owner, "phone_messages", occurrences),
        },
        # Solo las celdas con algo: el resto de la cuadrícula es cero.
        "cells": [cells[key] for key in sorted(cells)],
    }
