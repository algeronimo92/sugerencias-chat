"""Qué leads ve cada persona del equipo.

Por defecto todo el equipo ve todos los leads. Con el ajuste
``sellers_see_only_assigned_leads`` encendido, un vendedor ve solo los que
tiene asignados: ni los de otros ni los sin asignar. Los administradores ven
siempre todos, porque son quienes reparten.

La regla se aplica en tres lugares, y los tres tienen que coincidir: si una
lista oculta un lead pero el aviso en tiempo real lo deja pasar, al vendedor
le salta la notificación de escritorio de un cliente que no puede abrir.

- Listas, contadores y búsquedas: ``seller_scope`` va a ``LeadFilters.owner_id``.
- Rutas que reciben un lead por id: ``require_visible_lead`` (dependencia del
  router), que responde 404 igual que un lead inexistente.
- Tiempo real: ``lead_audience`` acota los avisos que llevan el texto de un
  mensaje y ``call_agents_for`` el timbre de las llamadas.
"""

from __future__ import annotations

from collections.abc import Iterable

from fastapi import Depends, Request

from app.modules.auth.ports.types import UserRole
from app.modules.auth.ports.users import list_active_sellers, list_call_agents
from app.modules.auth.public import User, get_current_user
from app.modules.leads.domain.errors import LeadNotFound
from app.modules.leads.queries import fetch_lead_sellers
from app.modules.platform.public import sellers_see_only_assigned_leads

# Nombres con que las rutas reciben el lead, en el path o en la query.
LEAD_ID_PARAMS = ("chat_id", "lead_id")


async def seller_scope(user: User) -> int | None:
    """Id del vendedor al que se acotan los leads de ``user``, o None si ve
    todos. Se lee en cada petición: el ajuste se cambia sin recargar."""
    if user.role != UserRole.SELLER:
        return None
    return user.id if await sellers_see_only_assigned_leads() else None


async def seller_scope_by_id(user_id: int) -> int | None:
    """Para las altas desde Citas o Contactos, que solo reciben el actor."""
    if not await sellers_see_only_assigned_leads():
        return None
    return next((user_id for user in await list_active_sellers() if user["id"] == user_id and user["role"] == UserRole.SELLER), None)


async def visible_lead_ids(user: User, lead_ids: Iterable[str]) -> set[str]:
    """De ``lead_ids``, los que ``user`` puede ver. Sin la visibilidad
    acotada son todos, sin consultar nada; con ella, solo los suyos que
    existen."""
    owner_id = await seller_scope(user)
    if owner_id is None:
        return set(lead_ids)
    sellers = await fetch_lead_sellers(list(lead_ids))
    return {lead_id for lead_id, seller_id in sellers.items() if seller_id == owner_id}


def _requested_lead_id(request: Request) -> str | None:
    for name in LEAD_ID_PARAMS:
        value = request.path_params.get(name) or request.query_params.get(name)
        if value:
            return str(value)
    return None


async def ensure_lead_visible(user: User, lead_id: str) -> None:
    """Levanta ``LeadNotFound`` si ``user`` no puede ver ``lead_id``. Un lead
    inexistente se deja pasar para que la ruta responda su propio 404; uno
    ajeno da el mismo 404, sin confirmar que existe."""
    owner_id = await seller_scope(user)
    if owner_id is None:
        return
    sellers = await fetch_lead_sellers([lead_id])
    if lead_id in sellers and sellers[lead_id] != owner_id:
        raise LeadNotFound()


async def require_visible_lead(request: Request, user: User = Depends(get_current_user)) -> None:
    """Dependencia de router: aplica ``ensure_lead_visible`` al lead que la
    ruta recibe en el path o en la query. Las que lo reciben en el cuerpo lo
    llaman a mano."""
    lead_id = _requested_lead_id(request)
    if lead_id is not None:
        await ensure_lead_visible(user, lead_id)


async def lead_audience(lead_id: str) -> frozenset[int] | None:
    """Vendedores que pueden recibir un aviso sobre ``lead_id``, o None si lo
    reciben todos (el ajuste apagado). Un lead sin asignar no tiene vendedor:
    solo se enteran los administradores."""
    if not await sellers_see_only_assigned_leads():
        return None
    seller_id = (await fetch_lead_sellers([lead_id])).get(lead_id)
    return frozenset({seller_id}) if seller_id is not None else frozenset()


async def call_agents_for(lead_id: str) -> list[dict]:
    """A quiénes les suena una llamada del cliente de ``lead_id``.

    Con el ajuste encendido, solo a los administradores y al vendedor del lead.
    """
    agents = await list_call_agents()
    audience = await lead_audience(lead_id)
    if audience is None:
        return agents
    allowed = [agent for agent in agents if agent.get("role") != UserRole.SELLER or agent["id"] in audience]
    return allowed


async def lead_recipients(lead_id: str, user_ids: Iterable[int]) -> set[int]:
    """Evita que una mención o recordatorio revele un lead ajeno, incluso
    cuando se guardó antes de activar el ajuste o de reasignar el lead."""
    wanted = set(user_ids)
    audience = await lead_audience(lead_id)
    if audience is None:
        return wanted
    return {
        user["id"] for user in await list_active_sellers()
        if user["id"] in wanted and (user["role"] == UserRole.ADMIN or user["id"] in audience)
    }
