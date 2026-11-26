"""Qué puede usar el negocio activo según su paquete.

Dos capas, independientes de los permisos: el permiso dice qué puede hacer
**la persona** según su rol; el paquete dice qué tiene **el negocio**. Una
ruta con función de paquete pide las dos (``require_permission`` y
``require_feature``).

Los topes (personas, automatizaciones encendidas) se revisan en el caso de uso
que crea o enciende, no en la ruta: así no se saltan llamando directo a la API.
Bajar de paquete nunca borra nada: solo impide sumar por encima del tope.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from uuid import UUID

from sqlalchemy import select

from app.core.errors import Conflict, Forbidden
from app.db.models.control import Organization
from app.db.session import control_session
from app.modules.platform.plans import (
    DEFAULT_PLAN,
    FEATURE_LABELS,
    PLANS,
    Feature,
    PlanSpec,
    minimum_plan_for,
    plan_spec,
)
from app.tenancy.context import get_current_tenant


class PlanFeatureMissing(Forbidden):
    """Esta función no está incluida en el paquete de tu negocio."""

    code = "plan_feature_missing"


class PlanLimitReached(Conflict):
    """Tu negocio llegó al tope de su paquete."""

    code = "plan_limit_reached"


# El paquete cambia muy de vez en cuando y se consulta en cada ruta que lo
# exige: un caché corto ahorra una consulta al plano de control por pedido.
# Con varias instancias (blue-green) el cambio tarda a lo sumo esto en verse
# en las otras; en la que atendió el cambio se ve al instante.
_CACHE_SECONDS = 30.0
_cache: dict[str, tuple[float, PlanSpec]] = {}


def invalidate_plan_cache(organization_id: UUID | str | None = None) -> None:
    if organization_id is None:
        _cache.clear()
    else:
        _cache.pop(str(organization_id), None)


async def plan_for(organization_id: UUID | str) -> PlanSpec:
    key = str(organization_id)
    cached = _cache.get(key)
    now = time.monotonic()
    if cached is not None and cached[0] > now:
        return cached[1]
    async with control_session() as session:
        plan = await session.scalar(select(Organization.plan).where(Organization.id == key))
    spec = plan_spec(plan)
    _cache[key] = (now + _CACHE_SECONDS, spec)
    return spec


async def current_plan() -> PlanSpec:
    """El paquete del negocio activo.

    Sin contexto de negocio (instalación de un solo negocio, sin plano de
    control) no hay paquete que limite: se comporta como el que trae todo.
    """

    context = get_current_tenant()
    if context is None:
        return PLANS[DEFAULT_PLAN]
    return await plan_for(context.organization_id)


async def has_feature(feature: Feature) -> bool:
    return (await current_plan()).has(feature)


async def ensure_feature(feature: Feature) -> None:
    plan = await current_plan()
    if plan.has(feature):
        return
    needed = minimum_plan_for(feature)
    raise PlanFeatureMissing(
        f"{FEATURE_LABELS[feature]} no está en el paquete {plan.name}: "
        f"viene desde {needed.name}. Para cambiar de paquete, contacta al equipo de CliniVentas."
    )


def require_feature(feature: Feature):
    """Dependencia de FastAPI: la ruta solo responde si el paquete la trae.

    ``__feature__`` lo mira ``tests/test_plans.py`` para comprobar que cada
    función del catálogo tiene al menos una ruta que la exige.
    """

    async def dependency() -> None:
        await ensure_feature(feature)

    dependency.__feature__ = feature
    dependency.__name__ = "require_feature_" + feature.value.replace(".", "_")
    return dependency


Counter = Callable[[], Awaitable[int]]


async def ensure_seat_available(seats_in_use: Counter) -> None:
    """``seats_in_use`` cuenta sin la persona que se quiere sumar; solo se
    llama si el paquete tiene tope."""

    plan = await current_plan()
    if plan.max_seats is None or await seats_in_use() < plan.max_seats:
        return
    raise PlanLimitReached(
        f"El paquete {plan.name} incluye hasta {plan.max_seats} personas atendiendo y ya están "
        "todas ocupadas. Desactiva a alguien, déjalo como solo lectura o cambia de paquete."
    )


async def ensure_automation_slot(active_automations: Counter) -> None:
    """``active_automations`` cuenta sin la que se quiere encender; solo se
    llama si el paquete tiene tope."""

    plan = await current_plan()
    if plan.max_active_automations is None or await active_automations() < plan.max_active_automations:
        return
    raise PlanLimitReached(
        f"El paquete {plan.name} permite {plan.max_active_automations} automatizaciones encendidas "
        "a la vez. Apaga otra antes de encender esta, o cambia de paquete."
    )
