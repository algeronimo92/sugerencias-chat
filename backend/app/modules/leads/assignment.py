"""Asignación automática de leads a vendedores por turnos (round robin).

Cada lead nuevo va al vendedor activo que hace más tiempo no recibe uno del
reparto (o que nunca recibió uno). No hay un índice de turno que mantener:
agregar, desactivar o excluir un vendedor no obliga a reiniciar nada, y uno
nuevo entra primero en la fila.
"""

from collections.abc import Collection

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.db.models.auth import User
from app.db.models.leads import LeadAssignmentTurn
from app.db.uow import session_scope, unit_of_work
from app.modules.leads.application.commands import update_lead
from app.modules.leads.domain.lead import Actor

# Motivo que queda en la actividad del lead: distingue el reparto automático
# de una asignación hecha a mano por alguien del equipo.
AUTO_ASSIGN_REASON = "reparto_automatico"


def parse_excluded_ids(raw: str | None) -> frozenset[int]:
    """Ids de vendedores que no reciben leads del reparto. Tolera espacios y
    basura: un valor mal guardado no puede frenar la llegada de mensajes."""
    ids = set()
    for part in (raw or "").split(","):
        part = part.strip()
        if part.isdigit():
            ids.add(int(part))
    return frozenset(ids)


async def pick_next_vendedor_id(excluded: Collection[int] = ()) -> int | None:
    """Devuelve el vendedor activo al que le toca el próximo lead, o None
    si no hay ningún vendedor activo. Dentro de una unidad de trabajo lee en
    su transacción (la del alta, que tiene tomado el lock del reparto)."""
    stmt = (
        select(User.id)
        .outerjoin(LeadAssignmentTurn, LeadAssignmentTurn.user_id == User.id)
        .where(User.role == "vendedor", User.is_active.is_(True))
        .order_by(LeadAssignmentTurn.last_assigned_at.asc().nulls_first(), User.id.asc())
        .limit(1)
    )
    if excluded:
        stmt = stmt.where(User.id.not_in(sorted(excluded)))
    async with session_scope() as session:
        return await session.scalar(stmt)


async def assign_next_seller(lead_id: str, *, excluded: Collection[int] = ()) -> int | None:
    """Asigna al lead recién creado el vendedor al que le toca.

    Se suma a la unidad de trabajo del alta: si el alta se revierte, el turno
    no se consume. El lock serializa las altas concurrentes; sin él, dos leads
    que llegan a la vez leían el mismo "menos reciente" y caían en el mismo
    vendedor. La asignación pasa por ``update_lead`` para que quede en la
    actividad del lead y avise en tiempo real como una asignación manual.
    """
    async with unit_of_work() as uow:
        await uow.session.execute(
            select(func.pg_advisory_xact_lock(
                func.hashtextextended("lead_round_robin_assignment", 0)
            ))
        )
        vendedor_id = await pick_next_vendedor_id(excluded)
        if vendedor_id is None:
            return None
        # clock_timestamp y no now(): now() es la hora de inicio de la
        # transacción, anterior a la espera del lock, y desordenaría la fila.
        stamp = insert(LeadAssignmentTurn).values(
            user_id=vendedor_id, last_assigned_at=func.clock_timestamp(),
        )
        await uow.session.execute(stamp.on_conflict_do_update(
            index_elements=[LeadAssignmentTurn.user_id],
            set_={"last_assigned_at": stamp.excluded.last_assigned_at},
        ))
        await update_lead(
            lead_id, {"vendedor_id": vendedor_id},
            actor=Actor.system(), metadata={"motivo": AUTO_ASSIGN_REASON},
        )
    return vendedor_id
