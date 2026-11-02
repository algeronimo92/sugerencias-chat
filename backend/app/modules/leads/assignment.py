"""Asignación automática de leads a vendedores por turnos (round robin).

No hay un puntero de turno persistido: cada lead nuevo se asigna al
vendedor activo que menos recientemente recibió uno (o que nunca recibió
uno). El reparto se autocorrige solo si se agrega, desactiva o reactiva
un vendedor, sin necesidad de reiniciar ningún contador.
"""

from sqlalchemy import func, select

from app.db.models.auth import User
from app.db.models.leads import Lead
from app.db.uow import session_scope


async def pick_next_vendedor_id() -> int | None:
    """Devuelve el vendedor activo al que le toca el próximo lead, o None
    si no hay ningún vendedor activo. Dentro de una unidad de trabajo lee en
    su transacción (la del alta, que tiene tomado el lock del reparto)."""
    stmt = (
        select(User.id)
        .outerjoin(Lead, Lead.vendedor_id == User.id)
        .where(User.role == "vendedor", User.is_active.is_(True))
        .group_by(User.id)
        .order_by(func.max(Lead.created_at).asc().nulls_first(), User.id.asc())
        .limit(1)
    )
    async with session_scope() as session:
        return await session.scalar(stmt)
