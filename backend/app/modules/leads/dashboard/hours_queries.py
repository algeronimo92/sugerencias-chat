"""A qué horas de la semana se mueve el negocio: cuándo llegan conversaciones
nuevas, cuántas siguen después de la primera respuesta y cuándo salen flujos.

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


CELL_FIELDS = ("conversations", "settled", "engaged", "flows_manual", "flows_automatic")


async def collect(scope: DashboardScope) -> dict:
    conversations, flows = await asyncio.gather(
        execute_mapping(activity.conversations_by_hour_stmt(scope)),
        execute_mapping(automations.by_hour_stmt(scope)),
    )
    cells: dict[tuple[int, int], dict] = {}
    for row in (*conversations, *flows):
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
        "weekday_occurrences": _weekday_occurrences(scope),
        # Solo las celdas con algo: el resto de la cuadrícula es cero.
        "cells": [cells[key] for key in sorted(cells)],
    }
