"""``ExecutionStore`` sobre PostgreSQL.

Cada método usa ``session_scope``: dentro de un caso de uso comparte su
transacción, y el motor (que guarda paso a paso) confirma cada escritura
por separado.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, and_, cast, exists, func, literal, not_, or_, select, update
from sqlalchemy.orm import aliased
from sqlalchemy.dialects.postgresql import JSONB, insert as pg_insert

from app.db.models.automations import AutomationExecution, AutomationExecutionMessage, AutomationFlowVersion, AutomationRoundRobinState, AutomationRule
from app.db.uow import session_scope
from app.modules.automations.domain.types import AutomationExecutionStatus, ExecutionStartSource
from app.modules.automations.domain.delivery import ExecutionDeliveryState, MessageDeliveryState, advance, message_ids_in, summarize
from app.modules.automations.domain.execution import Execution, Rule, initial_flow_state
from app.modules.automations.domain.limits import PAUSE_SCOPE_EXECUTION
from app.modules.automations.queries import get_automation_execution


# Cuántas filas mira el reclamo por cada una que puede tomar: las que sobran
# son de leads que ya tienen otra en el mismo lote.
CLAIM_SCAN_FACTOR = 5


def _has_started(execution):
    """Ya recorrió algún paso: una espera del flujo la devuelve a la cola sin
    marca de inicio, pero sigue a medias."""
    # Sin jsonb_array_length: una fila antigua con un escalar ahí haría
    # fallar el reclamo entero, y con él todas las automatizaciones.
    def non_empty_list(value):
        # coalesce: sin la clave, jsonb_typeof da NULL y el NOT de quien
        # pregunta "¿no empezó?" quedaría en NULL en vez de verdadero.
        return func.coalesce(
            and_(func.jsonb_typeof(value) == "array", value != cast(literal("[]"), JSONB)),
            False,
        )

    return or_(non_empty_list(execution.action_results), non_empty_list(execution.flow_state["path"]))


def _started_and_waiting(execution):
    """A medias y fuera del worker: esperando un plazo o una respuesta, o
    congelada a mano desde el chat."""
    return and_(
        execution.status.in_([AutomationExecutionStatus.SCHEDULED, AutomationExecutionStatus.PAUSED]),
        _has_started(execution),
    )


def _blocking_execution_exists(candidate):
    """Otra ejecución del mismo lead impide arrancar ``candidate``.

    Lo que está corriendo bloquea siempre. Lo que quedó a medias (en una
    espera o pausado) bloquea a las que todavía no empezaron, pero no a otra
    que también está a medias: si no, dos flujos esperando a la vez se
    trabarían para siempre. Un flujo hijo puede correr mientras su padre
    espera, y el padre retomar mientras el hijo espera: «Iniciar otro flujo»
    no retiene al padre.

    Lo que una persona lanza a mano manda sobre lo que estaba esperando: no
    hace cola detrás de un seguimiento a medias, y mientras el suyo sigue
    activo ese seguimiento no retoma. Antes el lanzamiento se rechazaba y la
    vendedora tenía que cancelar el seguimiento para mandar un precio (643
    cancelaciones a mano en DermicaPro). El seguimiento vuelve solo cuando el
    flujo manual termina, con el plazo que ya tenía vencido o por vencer.
    """
    other = aliased(AutomationExecution)
    same_lead = and_(other.lead_id == candidate.lead_id, other.id != candidate.id)
    # coalesce: sin padre, ->> da NULL, y NOT (NULL) también es NULL. La
    # ejecución dejaba de contar como bloqueante justo en el caso común.
    family = or_(
        func.coalesce(other.event_payload["parent_execution_id"].astext, "") == cast(candidate.id, String),
        func.coalesce(candidate.event_payload["parent_execution_id"].astext, "") == cast(other.id, String),
    )
    running = exists().where(same_lead, other.status == AutomationExecutionStatus.RUNNING)
    waiting = exists().where(same_lead, not_(family), _started_and_waiting(other))
    is_manual = candidate.start_source == ExecutionStartSource.MANUAL
    # Posterior (id mayor): entre dos lanzadas a mano gana la última, y nunca
    # se esperan una a la otra. Una congelada a mano (paused) no retiene a
    # nadie: puede quedar así semanas.
    newer_manual = exists().where(
        same_lead, not_(family),
        other.start_source == ExecutionStartSource.MANUAL,
        other.id > candidate.id,
        other.status == AutomationExecutionStatus.SCHEDULED,
    )
    return or_(
        running,
        and_(not_(_has_started(candidate)), not_(is_manual), waiting),
        newer_manual,
    )


async def _refresh_delivery(session, execution_id: int) -> None:
    """Recalcula el resumen de entrega de una ejecución desde sus mensajes."""
    # Se bloquea la ejecución antes de leer: los acuses de dos mensajes suyos
    # pueden llegar a la vez, y cada uno resumiría sin ver el cambio del otro.
    await session.execute(
        select(AutomationExecution.id).where(AutomationExecution.id == execution_id).with_for_update()
    )
    states = (await session.execute(
        select(AutomationExecutionMessage.state).where(AutomationExecutionMessage.execution_id == execution_id)
    )).scalars().all()
    await session.execute(update(AutomationExecution).where(
        AutomationExecution.id == execution_id,
    ).values(delivery_state=summarize(states)))


def to_rule(row: AutomationRule) -> Rule:
    return Rule(
        id=row.id,
        name=row.name,
        trigger_type=row.trigger_type,
        is_active=row.is_active,
        builder_mode=row.builder_mode,
        conditions=row.conditions or {},
        actions=row.actions or [],
        flow_version=row.flow_version or 0,
        published_flow_definition=row.published_flow_definition,
        max_executions_per_hour=row.max_executions_per_hour,
        created_by_user_id=row.created_by_user_id,
        deleted_at=row.deleted_at,
    )


def to_execution(row: AutomationExecution) -> Execution:
    return Execution(
        id=row.id,
        rule_id=row.rule_id,
        lead_id=row.lead_id,
        trigger_type=row.trigger_type,
        status=row.status,
        event_payload=row.event_payload or {},
        flow_state=row.flow_state or {},
        action_results=row.action_results or [],
        started_by_user_id=row.started_by_user_id,
        window_override_by_user_id=row.window_override_by_user_id,
        start_source=row.start_source or "system",
        error=row.error,
    )


def _resume_values(now: datetime) -> dict:
    """Cómo vuelve a la cola una ejecución congelada: `scheduled_for` corrido
    por lo que duró la pausa, así recupera el tiempo que le faltaba en vez de
    disparar de golpe por haber vencido mientras estaba detenida."""
    return {
        "status": AutomationExecutionStatus.SCHEDULED,
        # El literal va tipado: sin el tipo explícito, `$1 - timestamptz`
        # le deja a Postgres un parámetro sin tipo que resolver contra dos
        # firmas del operador `-`.
        "scheduled_for": AutomationExecution.scheduled_for + (
            literal(now, DateTime(timezone=True))
            - func.coalesce(AutomationExecution.paused_at, now)
        ),
        "paused_at": None,
        "pause_scope": None,
        "error": None,
    }


class SqlExecutionStore:
    async def load(self, execution_id: int) -> tuple[Execution | None, Rule | None]:
        async with session_scope() as session:
            execution = await session.get(AutomationExecution, execution_id)
            rule = await session.get(AutomationRule, execution.rule_id) if execution else None
            return (
                to_execution(execution) if execution else None,
                to_rule(rule) if rule else None,
            )

    async def rule(self, rule_id: int) -> Rule | None:
        async with session_scope() as session:
            rule = await session.get(AutomationRule, rule_id)
            return to_rule(rule) if rule else None

    async def save(self, execution_id: int, **values) -> bool:
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id,
                AutomationExecution.status.not_in([
                    AutomationExecutionStatus.SKIPPED, AutomationExecutionStatus.CANCELLED,
                ]),
            ).values(**values))
        return bool(result.rowcount)

    async def completed_since(self, rule_id: int, since: datetime) -> int:
        async with session_scope() as session:
            return await session.scalar(
                select(func.count(AutomationExecution.id)).where(
                    AutomationExecution.rule_id == rule_id,
                    AutomationExecution.status == AutomationExecutionStatus.COMPLETED,
                    AutomationExecution.finished_at >= since,
                )
            ) or 0

    async def completed_for_lead_since(self, rule_id: int, lead_id: str, since: datetime) -> bool:
        async with session_scope() as session:
            recent = await session.scalar(
                select(AutomationExecution.id).where(
                    AutomationExecution.rule_id == rule_id,
                    AutomationExecution.lead_id == lead_id,
                    AutomationExecution.status == AutomationExecutionStatus.COMPLETED,
                    AutomationExecution.finished_at >= since,
                ).limit(1)
            )
        return recent is not None

    async def flow_definition(self, rule_id: int, version: int) -> dict | None:
        async with session_scope() as session:
            return await session.scalar(select(AutomationFlowVersion.definition).where(
                AutomationFlowVersion.rule_id == rule_id,
                AutomationFlowVersion.version == version,
            ))

    async def schedule_child(
        self, *, rule: Rule, parent: Execution, event_key: str, payload: dict, now: datetime,
    ) -> int | None:
        async with session_scope() as session:
            child_id = (await session.execute(pg_insert(AutomationExecution).values(
                rule_id=rule.id,
                lead_id=parent.lead_id,
                trigger_type=rule.trigger_type,
                event_key=event_key,
                event_payload=payload,
                status=AutomationExecutionStatus.SCHEDULED,
                scheduled_for=now,
                action_results=[],
                flow_state=initial_flow_state(rule.builder_mode, rule.flow_version),
                created_at=now,
                start_source="flow",
                started_by_user_id=parent.started_by_user_id,
            ).on_conflict_do_nothing(
                index_elements=[AutomationExecution.rule_id, AutomationExecution.event_key]
            ).returning(AutomationExecution.id))).scalar_one_or_none()
            if child_id is None:
                child_id = await session.scalar(select(AutomationExecution.id).where(
                    AutomationExecution.rule_id == rule.id,
                    AutomationExecution.event_key == event_key,
                ))
        return child_id

    async def advance_round_robin(self, rule_id: int, node_id: str, now: datetime) -> int:
        async with session_scope() as session:
            return await session.scalar(pg_insert(AutomationRoundRobinState).values(
                rule_id=rule_id, node_id=node_id, counter=1, updated_at=now,
            ).on_conflict_do_update(
                index_elements=[AutomationRoundRobinState.rule_id, AutomationRoundRobinState.node_id],
                set_={"counter": AutomationRoundRobinState.counter + 1, "updated_at": now},
            ).returning(AutomationRoundRobinState.counter))

    async def round_robin_counter(self, rule_id: int, node_id: str) -> int:
        async with session_scope() as session:
            return await session.scalar(select(AutomationRoundRobinState.counter).where(
                AutomationRoundRobinState.rule_id == rule_id,
                AutomationRoundRobinState.node_id == node_id,
            )) or 0

    async def claim_due(self, now: datetime, limit: int) -> list[int]:
        # La pausa del lead no se mira acá a propósito: solo impide que los
        # disparadores creen ejecuciones nuevas (ver schedule_in_session). Lo
        # que ya estaba en marcha sigue; quien quiera detenerlo lo pausa o
        # cancela desde su tarjeta en el chat.
        #
        # Una sola automatización por lead a la vez: un mensaje entrante
        # dispara «conversación iniciada», «mensaje recibido» y a veces «lead
        # nuevo», y el lote las corría en paralelo, así que el cliente recibía
        # los mensajes de dos flujos intercalados. Lo que llega mientras otra
        # está en curso queda en cola y sale cuando esa termina.
        candidate = AutomationExecution
        blocking = _blocking_execution_exists(candidate)
        async with session_scope() as session:
            # Dos réplicas del worker (blue-green) no deben reclamar a la vez
            # dos ejecuciones del mismo lead: ninguna vería la otra sin
            # confirmar. El reclamo es corto, así que se serializa por negocio.
            await session.execute(select(func.pg_advisory_xact_lock(
                func.hashtext(func.concat(func.current_schema(), literal(".automation_claim")))
            )))
            rows = (await session.execute(
                select(candidate.id, candidate.lead_id).where(
                    candidate.status == AutomationExecutionStatus.SCHEDULED,
                    candidate.scheduled_for <= now,
                    not_(blocking),
                ).order_by(candidate.scheduled_for.asc(), candidate.id.asc()).limit(limit * CLAIM_SCAN_FACTOR)
            )).all()
            ids: list[int] = []
            leads: set[str] = set()
            for execution_id, lead_id in rows:
                if lead_id is not None and lead_id in leads:
                    continue
                if lead_id is not None:
                    leads.add(lead_id)
                ids.append(execution_id)
                if len(ids) >= limit:
                    break
            if ids:
                await session.execute(update(AutomationExecution).where(
                    AutomationExecution.id.in_(ids)
                ).values(
                    status=AutomationExecutionStatus.RUNNING,
                    started_at=now,
                    error=None,
                ))
        return ids

    async def find_by_event_key(self, rule_id: int, event_key: str) -> int | None:
        async with session_scope() as session:
            return await session.scalar(select(AutomationExecution.id).where(
                AutomationExecution.rule_id == rule_id,
                AutomationExecution.event_key == event_key,
            ))

    async def view(self, execution_id: int) -> dict | None:
        return await get_automation_execution(execution_id)

    async def requeue(self, execution_id: int, now: datetime, *, override_by_user_id: int | None) -> bool:
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id,
                AutomationExecution.status.in_([
                    AutomationExecutionStatus.FAILED, AutomationExecutionStatus.SKIPPED,
                ]),
            ).values(
                status=AutomationExecutionStatus.SCHEDULED,
                scheduled_for=now,
                started_at=None,
                finished_at=None,
                error=None,
                error_code=None,
                attention_dismissed_at=None,
                attempts=0,
                window_override_by_user_id=override_by_user_id,
                window_override_at=now if override_by_user_id is not None else None,
            ))
        return bool(result.rowcount)

    async def resume_lead(self, lead_id: str, now: datetime) -> int:
        # Compatibilidad: hasta el 2026-11-09 pausar el lead congelaba sus
        # ejecuciones de sistema (pause_scope 'lead'; NULL en las anteriores a
        # la columna). Ya no se congela nada así, pero lo que quedó congelado
        # en producción tiene que volver cuando se reactive el bot.
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.lead_id == lead_id,
                AutomationExecution.status == AutomationExecutionStatus.PAUSED,
                AutomationExecution.pause_scope.is_distinct_from(PAUSE_SCOPE_EXECUTION),
            ).values(**_resume_values(now)))
        return result.rowcount or 0

    async def track_messages(self, execution_id: int, message_ids: list[int], now: datetime) -> None:
        if not message_ids:
            return
        async with session_scope() as session:
            await session.execute(pg_insert(AutomationExecutionMessage).values([
                {
                    "message_id": message_id, "execution_id": execution_id, "state": MessageDeliveryState.PENDING,
                    "updated_at": now, "created_at": now,
                }
                for message_id in message_ids
            ]).on_conflict_do_nothing(index_elements=[AutomationExecutionMessage.message_id]))
            await _refresh_delivery(session, execution_id)

    async def messages_queued_for_lead_since(self, lead_id: str, since: datetime) -> int:
        async with session_scope() as session:
            return await session.scalar(
                select(func.count(AutomationExecutionMessage.message_id))
                .join(AutomationExecution, AutomationExecution.id == AutomationExecutionMessage.execution_id)
                .where(AutomationExecution.lead_id == lead_id, AutomationExecutionMessage.created_at >= since)
            ) or 0

    async def record_message_state(self, message_id: int, state: str, now: datetime) -> int | None:
        async with session_scope() as session:
            # FOR UPDATE: dos acuses del mismo mensaje llegan a la vez (Meta
            # los reintenta) y sin el bloqueo el más viejo podía ganar.
            row = (await session.execute(
                select(AutomationExecutionMessage.execution_id, AutomationExecutionMessage.state)
                .where(AutomationExecutionMessage.message_id == message_id)
                .with_for_update()
            )).first()
            if row is None:
                return None
            execution_id, current = row
            new_state = advance(current, state)
            if new_state != current:
                await session.execute(update(AutomationExecutionMessage).where(
                    AutomationExecutionMessage.message_id == message_id,
                ).values(state=new_state, updated_at=now))
                await _refresh_delivery(session, execution_id)
        return execution_id

    async def queued_message_ids(self, after_id: int, limit: int) -> list[tuple[int, list[int]]]:
        async with session_scope() as session:
            rows = (await session.execute(
                select(AutomationExecution.id, AutomationExecution.action_results)
                .where(AutomationExecution.id > after_id)
                .order_by(AutomationExecution.id.asc()).limit(limit)
            )).all()
        return [(execution_id, message_ids_in(results)) for execution_id, results in rows]

    async def tracked_message_states(self, execution_ids: list[int]) -> dict[int, dict[int, str]]:
        tracked: dict[int, dict[int, str]] = {execution_id: {} for execution_id in execution_ids}
        if not execution_ids:
            return tracked
        async with session_scope() as session:
            rows = (await session.execute(
                select(
                    AutomationExecutionMessage.execution_id, AutomationExecutionMessage.message_id,
                    AutomationExecutionMessage.state,
                ).where(AutomationExecutionMessage.execution_id.in_(execution_ids))
            )).all()
        for execution_id, message_id, state in rows:
            tracked[execution_id][message_id] = state
        return tracked

    async def replace_message_states(self, execution_id: int, states: dict[int, str], now: datetime) -> None:
        if not states:
            return
        async with session_scope() as session:
            insert = pg_insert(AutomationExecutionMessage).values([
                {"message_id": message_id, "execution_id": execution_id, "state": state, "updated_at": now}
                for message_id, state in states.items()
            ])
            await session.execute(insert.on_conflict_do_update(
                index_elements=[AutomationExecutionMessage.message_id],
                set_={"state": insert.excluded.state, "updated_at": now},
            ))
            await _refresh_delivery(session, execution_id)

    async def dismiss(self, execution_id: int, now: datetime) -> bool:
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id,
                or_(
                    AutomationExecution.status.in_([
                        AutomationExecutionStatus.FAILED, AutomationExecutionStatus.PAUSED,
                    ]),
                    # Recorrió sus pasos pero algún mensaje no se entregó:
                    # también aparece en «Por atender».
                    AutomationExecution.delivery_state == ExecutionDeliveryState.FAILED,
                ),
            ).values(attention_dismissed_at=now))
        return bool(result.rowcount)

    async def pause(self, execution_id: int, now: datetime) -> bool:
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id,
                AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
            ).values(
                status=AutomationExecutionStatus.PAUSED,
                paused_at=now,
                pause_scope=PAUSE_SCOPE_EXECUTION,
                attention_dismissed_at=None,
                error=None,
            ))
        return bool(result.rowcount)

    async def resume(self, execution_id: int, now: datetime) -> bool:
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id,
                AutomationExecution.status == AutomationExecutionStatus.PAUSED,
            ).values(**_resume_values(now)))
        return bool(result.rowcount)

    async def cancel(self, execution_id: int, now: datetime) -> bool:
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id,
                AutomationExecution.status.in_([
                    AutomationExecutionStatus.SCHEDULED,
                    AutomationExecutionStatus.RUNNING,
                    # Una congelada también se puede descartar: es lo que hace
                    # el vendedor cuando no quiere que ese flujo retome.
                    AutomationExecutionStatus.PAUSED,
                ]),
            ).values(
                status=AutomationExecutionStatus.CANCELLED,
                error="Cancelada manualmente",
                paused_at=None,
                pause_scope=None,
                finished_at=now,
            ))
        return bool(result.rowcount)
