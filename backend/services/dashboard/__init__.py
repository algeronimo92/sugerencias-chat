"""Métricas del dashboard, agrupadas por bloque.

Antes era un módulo plano admin-only. Se partió cuando el dashboard se abrió a
los vendedores: cada bloque (`summary`, `leads`, `automations`, `tags`,
`appointments`, `activity`) resuelve sus consultas en paralelo y el orquestador
las une en un payload único, porque el panel las muestra todas de una y pedirlas
por separado multiplicaría los round-trips y el trabajo de caché.
"""

import asyncio
from time import monotonic

from . import activity, appointments, automations, leads, summary, tags
from .context import SCOPE_MINE, SCOPE_TEAM, DashboardScope, build_scope


_CACHE_TTL_SECONDS = 30.0
# Clave: (days, scope, user_id). El scope propio depende del usuario, así que
# la caché no puede ser global como cuando el dashboard era solo del admin.
_cache: dict[tuple[int, str, int], tuple[float, dict]] = {}
_cache_lock = asyncio.Lock()


async def _compute(scope: DashboardScope) -> dict:
    summary_block, leads_block, automations_block, tags_block, appointments_block, activity_block = (
        await asyncio.gather(
            summary.collect(scope),
            leads.collect(scope),
            automations.collect(scope),
            tags.collect(scope),
            appointments.collect(scope),
            activity.collect(scope),
        )
    )
    # La cobertura de etiquetado ya se calculó en su bloque; se repite en la
    # fila de KPIs sin volver a consultarla.
    summary_block["tagged_leads"] = tags_block["coverage"]["tagged"]
    return {
        "period_days": scope.days,
        "scope": scope.scope,
        "summary": summary_block,
        **leads_block,
        "automations": automations_block,
        "tags": tags_block,
        "appointments": appointments_block,
        "activity": activity_block,
        "generated_at": scope.now.isoformat(),
    }


async def get_dashboard_metrics(days: int, scope: str, user_id: int) -> dict:
    key = (days, scope, user_id if scope == SCOPE_MINE else 0)
    cached = _cache.get(key)
    if cached and cached[0] > monotonic():
        return cached[1]

    async with _cache_lock:
        cached = _cache.get(key)
        if cached and cached[0] > monotonic():
            return cached[1]
        result = await _compute(build_scope(days, scope, user_id))
        _cache[key] = (monotonic() + _CACHE_TTL_SECONDS, result)
        return result


__all__ = ["SCOPE_MINE", "SCOPE_TEAM", "get_dashboard_metrics"]
