from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import AutomationRoundRobinState
from db.session import get_sessionmaker
from services.automation_deps import DEFAULT_DEPS, AutomationDeps


async def _next_round_robin_output(
    rule_id: int, node_id: str, outputs: list[dict], deps: AutomationDeps = DEFAULT_DEPS,
) -> dict:
    """Avanza el turno del bloque y devuelve la salida que le toca.

    El incremento y la lectura van en la misma sentencia para que dos
    ejecuciones simultáneas no se lleven el mismo turno. El módulo se aplica
    al leer y no al guardar: así cambiar la cantidad de salidas al republicar
    no obliga a reiniciar el contador.
    """
    now = deps.now()
    async with deps.session() as session:
        counter = await session.scalar(pg_insert(AutomationRoundRobinState).values(
            rule_id=rule_id, node_id=node_id, counter=1, updated_at=now,
        ).on_conflict_do_update(
            index_elements=[
                AutomationRoundRobinState.rule_id, AutomationRoundRobinState.node_id,
            ],
            set_={
                "counter": AutomationRoundRobinState.counter + 1,
                "updated_at": now,
            },
        ).returning(AutomationRoundRobinState.counter))
        await session.commit()
    return outputs[(int(counter or 1) - 1) % len(outputs)]


async def _peek_round_robin_output(rule_id: int, node_id: str, outputs: list[dict]) -> dict:
    """La salida que tomaría la próxima ejecución, sin gastar el turno — para
    la simulación, que no debe alterar el reparto real."""
    async with get_sessionmaker()() as session:
        counter = await session.scalar(select(AutomationRoundRobinState.counter).where(
            AutomationRoundRobinState.rule_id == rule_id,
            AutomationRoundRobinState.node_id == node_id,
        ))
    return outputs[int(counter or 0) % len(outputs)]
