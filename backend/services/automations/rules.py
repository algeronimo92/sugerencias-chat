from datetime import date, datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime, func, insert, literal, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased

from db.models import AutomationExecution, AutomationRule, Lead, User
from db.session import get_sessionmaker
from domain_types import AutomationBuilderMode, AutomationExecutionStatus, AutomationTrigger
from services.automation_rules import local_day_range_utc
from services.automations.common import (
    ACTIVE_EXECUTION_STATUSES,
    PAUSE_SCOPE_EXECUTION,
    PAUSE_SCOPE_LEAD,
    _execution_dict,
    _rule_dict,
    _wake,
)
from services.automations.scheduler import (
    _backfill_customer_response_deadlines,
    schedule_automation_event,
)
from services.ws_manager import manager


async def list_automation_rules() -> list[dict]:
    execution_count = (
        select(func.count(AutomationExecution.id))
        .where(AutomationExecution.rule_id == AutomationRule.id)
        .correlate(AutomationRule)
        .scalar_subquery()
    )
    last_execution_at = (
        select(AutomationExecution.created_at)
        .where(AutomationExecution.rule_id == AutomationRule.id)
        .order_by(AutomationExecution.created_at.desc(), AutomationExecution.id.desc())
        .limit(1)
        .correlate(AutomationRule)
        .scalar_subquery()
    )
    last_execution_status = (
        select(AutomationExecution.status)
        .where(AutomationExecution.rule_id == AutomationRule.id)
        .order_by(AutomationExecution.created_at.desc(), AutomationExecution.id.desc())
        .limit(1)
        .correlate(AutomationRule)
        .scalar_subquery()
    )
    stmt = select(
        AutomationRule.id,
        AutomationRule.name,
        AutomationRule.trigger_type,
        AutomationRule.trigger_config,
        AutomationRule.conditions,
        AutomationRule.actions,
        AutomationRule.builder_mode,
        AutomationRule.flow_definition,
        AutomationRule.published_flow_definition,
        AutomationRule.flow_version,
        AutomationRule.delay_minutes,
        AutomationRule.max_executions_per_hour,
        AutomationRule.is_active,
        AutomationRule.visible_to_sellers,
        AutomationRule.created_by_user_id,
        User.name.label("created_by_name"),
        execution_count.label("execution_count"),
        last_execution_at.label("last_execution_at"),
        last_execution_status.label("last_execution_status"),
        AutomationRule.created_at,
        AutomationRule.updated_at,
    ).join(User, User.id == AutomationRule.created_by_user_id).where(
        AutomationRule.deleted_at.is_(None)
    ).order_by(
        AutomationRule.is_active.desc(), AutomationRule.updated_at.desc()
    )
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_rule_dict(row) for row in rows]


async def get_automation_rule(rule_id: int) -> dict | None:
    return next((rule for rule in await list_automation_rules() if rule["id"] == rule_id), None)


async def create_automation_rule(values: dict, user_id: int) -> dict:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        rule_id = (await session.execute(
            insert(AutomationRule).values(
                **values,
                created_by_user_id=user_id,
                created_at=now,
                updated_at=now,
            ).returning(AutomationRule.id)
        )).scalar_one()
        await session.commit()
    item = await get_automation_rule(rule_id)
    if item and item["is_active"] and item["trigger_type"] == AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE:
        await _backfill_customer_response_deadlines(rule_id)
    return item


async def duplicate_automation_rule(rule_id: int, user_id: int) -> dict | None:
    current = await get_automation_rule(rule_id)
    if current is None:
        return None
    is_visual = current["builder_mode"] == AutomationBuilderMode.VISUAL
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        new_id = (await session.execute(insert(AutomationRule).values(
            name=f"{current['name']} (copia)"[:120],
            trigger_type=current["trigger_type"],
            trigger_config=current["trigger_config"],
            conditions={} if is_visual else current["conditions"],
            actions=[] if is_visual else current["actions"],
            delay_minutes=0 if is_visual else current["delay_minutes"],
            max_executions_per_hour=current["max_executions_per_hour"],
            # Siempre arranca inactiva: evita tener dos reglas idénticas
            # corriendo a la vez sin que el usuario lo haya decidido. Por la
            # misma razón, nunca copia visible_to_sellers=True: el admin debe
            # decidir a propósito que la copia quede visible para vendedores.
            is_active=False,
            visible_to_sellers=False,
            builder_mode=current["builder_mode"],
            flow_definition=current["flow_definition"] if is_visual else {},
            published_flow_definition=None,
            flow_version=0,
            created_by_user_id=user_id,
            created_at=now,
            updated_at=now,
        ).returning(AutomationRule.id))).scalar_one()
        await session.commit()
    await manager.broadcast({"type": "automations_updated"})
    return await get_automation_rule(new_id)


async def update_automation_rule(rule_id: int, values: dict) -> dict | None:
    deadline_changed = bool(
        {"is_active", "trigger_type", "trigger_config", "delay_minutes"} & set(values)
    )
    if values:
        values["updated_at"] = datetime.now(timezone.utc)
        async with get_sessionmaker()() as session:
            result = await session.execute(
                update(AutomationRule).where(
                    AutomationRule.id == rule_id,
                    AutomationRule.deleted_at.is_(None),
                ).values(**values)
            )
            await session.commit()
        if not result.rowcount:
            return None
    item = await get_automation_rule(rule_id)
    if (
        deadline_changed
        and item
        and item["is_active"]
        and item["trigger_type"] == AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE
    ):
        await _backfill_customer_response_deadlines(rule_id)
    return item


async def delete_automation_rule(rule_id: int) -> dict | None:
    """Oculta una regla sin destruir sus ejecuciones ni versiones auditables.

    Las ejecuciones programadas se cierran como omitidas. Una ejecución que ya
    está corriendo bloquea el borrado porque podría completar acciones después
    de que el usuario creyera eliminada la automatización.
    """
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        rule = (await session.execute(
            select(AutomationRule).where(
                AutomationRule.id == rule_id,
                AutomationRule.deleted_at.is_(None),
            ).with_for_update()
        )).scalar_one_or_none()
        if rule is None:
            return None
        active_executions = (await session.execute(select(
            AutomationExecution.id,
            AutomationExecution.status,
        ).where(
            AutomationExecution.rule_id == rule_id,
            AutomationExecution.status.in_([
                AutomationExecutionStatus.SCHEDULED,
                AutomationExecutionStatus.RUNNING,
            ]),
        ).with_for_update())).mappings().all()
        if any(row["status"] == AutomationExecutionStatus.RUNNING for row in active_executions):
            raise ValueError(
                "La automatización tiene una ejecución en curso. Cancélala o espera a que termine antes de eliminarla."
            )
        scheduled = await session.execute(update(AutomationExecution).where(
            AutomationExecution.rule_id == rule_id,
            AutomationExecution.status.in_([
                AutomationExecutionStatus.SCHEDULED,
                # También las congeladas por la pausa de un lead: si no, al
                # reanudar volverían a la cola de una regla que ya no existe.
                AutomationExecutionStatus.PAUSED,
            ]),
        ).values(
            status=AutomationExecutionStatus.SKIPPED,
            error="La automatización fue eliminada",
            paused_at=None,
            pause_scope=None,
            finished_at=now,
        ))
        await session.execute(update(AutomationRule).where(
            AutomationRule.id == rule_id,
        ).values(is_active=False, deleted_at=now, updated_at=now))
        await session.commit()
    return {"id": rule_id, "cancelled_executions": scheduled.rowcount or 0}


async def list_automation_executions(
    rule_id: int | None = None,
    status: str | None = None,
    limit: int = 100,
    execution_id: int | None = None,
    exclude_skipped: bool = False,
    lead_id: str | None = None,
    start_source: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    active: bool | None = None,
    started_by_user_id: int | None = None,
) -> list[dict]:
    # Alias propio: `User` ya está tomado por started_by_user_id y la fila
    # necesita los dos nombres a la vez (quién la arrancó y quién autorizó
    # saltarse la ventana).
    override_user = aliased(User)
    stmt = select(
        AutomationExecution.id,
        AutomationExecution.rule_id,
        AutomationRule.name.label("rule_name"),
        AutomationRule.deleted_at.is_not(None).label("rule_deleted"),
        AutomationExecution.lead_id,
        Lead.nombre.label("lead_name"),
        AutomationExecution.trigger_type,
        AutomationExecution.status,
        AutomationExecution.scheduled_for,
        AutomationExecution.paused_at,
        AutomationExecution.pause_scope,
        AutomationExecution.started_at,
        AutomationExecution.finished_at,
        AutomationExecution.action_results,
        AutomationExecution.flow_state,
        AutomationExecution.error,
        AutomationExecution.created_at,
        AutomationExecution.start_source,
        AutomationExecution.started_by_user_id,
        User.name.label("started_by_name"),
        AutomationExecution.window_override_at,
        override_user.name.label("window_override_by_name"),
    ).join(AutomationRule, AutomationRule.id == AutomationExecution.rule_id).outerjoin(
        Lead, Lead.id == AutomationExecution.lead_id
    ).outerjoin(
        User, User.id == AutomationExecution.started_by_user_id
    ).outerjoin(
        override_user, override_user.id == AutomationExecution.window_override_by_user_id
    )
    if rule_id is not None:
        stmt = stmt.where(AutomationExecution.rule_id == rule_id)
    if status:
        stmt = stmt.where(AutomationExecution.status == status)
    elif exclude_skipped:
        stmt = stmt.where(AutomationExecution.status != AutomationExecutionStatus.SKIPPED)
    elif active is not None:
        # Un status puntual manda sobre este filtro rápido, igual que ya pasa
        # arriba con exclude_skipped.
        stmt = stmt.where(AutomationExecution.status.in_(ACTIVE_EXECUTION_STATUSES) if active
                           else AutomationExecution.status.not_in(ACTIVE_EXECUTION_STATUSES))
    if execution_id is not None:
        stmt = stmt.where(AutomationExecution.id == execution_id)
    if lead_id is not None:
        stmt = stmt.where(AutomationExecution.lead_id == lead_id)
    if start_source is not None:
        stmt = stmt.where(AutomationExecution.start_source == start_source)
    if started_by_user_id is not None:
        stmt = stmt.where(AutomationExecution.started_by_user_id == started_by_user_id)
    if date_from is not None and date_to is not None:
        range_start, range_end = local_day_range_utc(date_from, date_to)
        stmt = stmt.where(AutomationExecution.created_at >= range_start, AutomationExecution.created_at < range_end)
    stmt = stmt.order_by(AutomationExecution.created_at.desc(), AutomationExecution.id.desc()).limit(limit)
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_execution_dict(row) for row in rows]


async def get_automation_execution(execution_id: int) -> dict | None:
    rows = await list_automation_executions(execution_id=execution_id, limit=1)
    return rows[0] if rows else None


async def retry_automation_execution(
    execution_id: int,
    *,
    ignore_service_window: bool = False,
    actor_user_id: int | None = None,
) -> dict | None:
    """Reintenta una ejecución failed o skipped desde donde quedó — no repite
    acciones ya persistidas en action_results. Nunca aplica a completed: eso
    reiniciaría el flujo desde el disparador y reenviaría lo ya enviado.

    Resetea attempts a 0: es un reinicio explícito del usuario, no debería
    heredar el contador de recuperaciones automáticas agotado que la llevó a
    failed (si no, una ejecución que se vuelve a atascar moriría en el primer
    ciclo de _release_stale_executions sin darle ninguna chance).

    Con `ignore_service_window` el admin autoriza a esta ejecución (y solo a
    esta) a enviar con la ventana de 24 h cerrada, y queda registrado quién lo
    hizo. Cada reintento define el permiso de nuevo: uno común lo limpia, para
    que una autorización vieja no se arrastre sin que nadie la pida."""
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        execution = await session.get(AutomationExecution, execution_id)
        if execution is None or execution.status not in {
            AutomationExecutionStatus.FAILED, AutomationExecutionStatus.SKIPPED,
        }:
            return None
        rule = await session.get(AutomationRule, execution.rule_id)
        if rule is None or rule.deleted_at is not None or not rule.is_active:
            return None
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
            attempts=0,
            window_override_by_user_id=actor_user_id if ignore_service_window else None,
            window_override_at=now if ignore_service_window else None,
        ))
        await session.commit()
    if not result.rowcount:
        return None
    await manager.broadcast({"type": "automations_updated"})
    _wake.set()
    return await get_automation_execution(execution_id)


async def pause_lead_executions(lead_id: str) -> int:
    """Al pausar la automatización de un lead, congela lo que tiene programado
    de disparadores de sistema en vez de cancelarlo: `paused`, con
    `scheduled_for` intacto y `paused_at` marcando desde cuándo, para que
    `resume_lead_executions` le devuelva el tiempo que le faltaba.

    Incluye a las que están esperando en un bloque Pausa/Pregunta — para el
    scheduler eso es simplemente una fila `scheduled` con `scheduled_for`
    futuro, así que un flujo congelado a mitad de camino retoma después por
    donde iba.

    No toca lo que está corriendo en este instante (`_action_*` no se
    interrumpe a mitad de envío, mismo criterio que `delete_automation_rule`);
    de eso se encarga `_persist_visual_execution`, que congela la ejecución
    cuando llega a su siguiente espera. Tampoco toca los flujos manuales del
    vendedor (`start_source == "manual"`), que pidió a propósito y puede
    pausar o cancelar uno por uno desde el chat."""
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        result = await session.execute(update(AutomationExecution).where(
            AutomationExecution.lead_id == lead_id,
            AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
            AutomationExecution.start_source != "manual",
        ).values(
            status=AutomationExecutionStatus.PAUSED,
            paused_at=now,
            pause_scope=PAUSE_SCOPE_LEAD,
            error=None,
        ))
        await session.commit()
    if result.rowcount:
        await manager.broadcast({"type": "automations_updated"})
    return result.rowcount or 0


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


async def resume_lead_executions(lead_id: str) -> int:
    """Devuelve a la cola lo que quedó congelado por la pausa del lead,
    corriendo `scheduled_for` por lo que duró la pausa: una espera de 2 horas
    a la que le faltaban 20 minutos vuelve a tener 20 minutos por delante, no
    dispara de golpe por haber vencido durante la pausa.

    `waiting_since` de los bloques Pausa/Pregunta no se corre a propósito: si
    el cliente escribió mientras el vendedor atendía a mano, esa respuesta es
    real y el flujo debe seguir por la rama del mensaje.

    Solo descongela lo que congeló la pausa del lead: una ejecución que el
    vendedor pausó puntualmente (`pause_scope == 'execution'`) sigue detenida
    hasta que la reanude con su propio botón. NULL son las pausas anteriores a
    la columna, todas de alcance lead."""
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        result = await session.execute(update(AutomationExecution).where(
            AutomationExecution.lead_id == lead_id,
            AutomationExecution.status == AutomationExecutionStatus.PAUSED,
            AutomationExecution.pause_scope.is_distinct_from(PAUSE_SCOPE_EXECUTION),
        ).values(**_resume_values(now)))
        await session.commit()
    if result.rowcount:
        await manager.broadcast({"type": "automations_updated"})
        _wake.set()
    return result.rowcount or 0


async def pause_automation_execution(execution_id: int) -> dict | None:
    """Congela una sola ejecución, sin tocar el resto de lo que el sistema
    tenga en marcha sobre el lead: el botón de pausa que el vendedor tiene al
    lado de "Cancelar" en el panel de automatizaciones del chat.

    A diferencia de la pausa del lead, acá sí entran los flujos manuales: es la
    forma de frenar un flujo que el propio vendedor arrancó sin perder lo que
    ya avanzó (cancelar es terminal y obliga a repetirlo desde el principio).

    Solo aplica a una ejecución `scheduled` — que es todo flujo detenido en una
    espera, un bloque Pausa o una Pregunta. Una `running` está enviando un paso
    en este instante y no se interrumpe a mitad de camino (mismo criterio que
    `pause_lead_executions`); devuelve None para que el caller lo explique."""
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        result = await session.execute(update(AutomationExecution).where(
            AutomationExecution.id == execution_id,
            AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
        ).values(
            status=AutomationExecutionStatus.PAUSED,
            paused_at=now,
            pause_scope=PAUSE_SCOPE_EXECUTION,
            error=None,
        ))
        await session.commit()
    if not result.rowcount:
        return None
    await manager.broadcast({"type": "automations_updated"})
    return await get_automation_execution(execution_id)


async def resume_automation_execution(execution_id: int) -> dict | None:
    """Devuelve a la cola una ejecución congelada, con el tiempo que le
    faltaba. Sirve para las dos pausas: la puntual del vendedor y la que dejó
    la pausa del lead (reanudar una sola es menos drástico que reanudarlo todo).

    Con el lead todavía pausado no tiene sentido: `process_due_automation_
    executions` la volvería a congelar al vencer. Eso se corta acá con un error
    claro en vez de dejar un botón que aparenta no hacer nada — salvo en los
    flujos manuales, que la pausa del lead nunca frena."""
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        execution = await session.get(AutomationExecution, execution_id)
        if execution is None or execution.status != AutomationExecutionStatus.PAUSED:
            return None
        if execution.start_source != "manual" and execution.lead_id:
            lead = await session.get(Lead, execution.lead_id)
            if lead is not None and lead.automatizacion_pausada:
                raise ValueError(
                    "Este chat tiene la automatización pausada: reanudala con el botón "
                    "del bot en la cabecera para que el flujo siga."
                )
        result = await session.execute(update(AutomationExecution).where(
            AutomationExecution.id == execution_id,
            AutomationExecution.status == AutomationExecutionStatus.PAUSED,
        ).values(**_resume_values(now)))
        await session.commit()
    if not result.rowcount:
        return None
    await manager.broadcast({"type": "automations_updated"})
    _wake.set()
    return await get_automation_execution(execution_id)


async def cancel_automation_execution(execution_id: int) -> dict | None:
    async with get_sessionmaker()() as session:
        result = await session.execute(update(AutomationExecution).where(
            AutomationExecution.id == execution_id,
            AutomationExecution.status.in_([
                AutomationExecutionStatus.SCHEDULED,
                AutomationExecutionStatus.RUNNING,
                # Una congelada también se puede descartar: es lo que hace el
                # vendedor cuando no quiere que ese flujo retome al reanudar.
                AutomationExecutionStatus.PAUSED,
            ]),
        ).values(
            status=AutomationExecutionStatus.SKIPPED,
            error="Cancelada manualmente",
            paused_at=None,
            pause_scope=None,
            finished_at=datetime.now(timezone.utc),
        ))
        await session.commit()
    if not result.rowcount:
        return None
    await manager.broadcast({"type": "automations_updated"})
    return await get_automation_execution(execution_id)


async def list_manual_flows(is_admin: bool) -> list[dict]:
    """Flujos visuales con trigger manual que puede disparar un vendedor desde
    el chat de un lead. El admin además ve los que todavía no marcó visibles
    (para poder probarlos) o que siguen sin publicar/activar."""
    rules = await list_automation_rules()
    return [
        rule for rule in rules
        if rule["builder_mode"] == AutomationBuilderMode.VISUAL
        and rule["trigger_type"] == AutomationTrigger.MANUAL
        and (is_admin or (rule["visible_to_sellers"] and rule["is_active"]))
    ]


async def start_manual_flow_execution(
    rule_id: int, lead_id: str, started_by_user_id: int, is_admin: bool,
) -> dict:
    """Arranca, con un click del vendedor, una ejecución de un flujo visual de
    trigger manual sobre un lead puntual.

    A diferencia de los triggers de sistema (que dedupan por event_key fijo:
    un lead solo entra una vez por lead_created, stage_changed, etc.), acá el
    vendedor debe poder repetir el mismo flujo sobre el mismo lead una vez que
    la ejecución anterior terminó — por eso la event_key lleva un uuid único
    por click en vez de derivarse del lead o del evento, y nunca choca con el
    índice único (rule_id, event_key). Lo que sí impide una segunda ejecución
    en curso es el índice único parcial (rule_id, lead_id) sobre ejecuciones
    manuales no terminales (ver migración b3d8f5c1a927): un doble click, dos
    vendedores, o un refresh accidental chocan contra él y ese conflicto se
    traduce acá abajo en un mensaje claro en vez de propagarse como un 500.
    """
    rule = await get_automation_rule(rule_id)
    if rule is None:
        raise ValueError("Flujo no encontrado")
    if rule["builder_mode"] != AutomationBuilderMode.VISUAL or rule["trigger_type"] != AutomationTrigger.MANUAL:
        raise ValueError("La regla no es un flujo de inicio manual")
    if not rule["is_active"]:
        raise ValueError("Publica y activa el flujo antes de iniciarlo")
    if not is_admin and not rule["visible_to_sellers"]:
        raise ValueError("Este flujo no está disponible para vendedores")

    event_key = f"manual:{uuid4()}"
    try:
        created = await schedule_automation_event(
            AutomationTrigger.MANUAL,
            lead_id,
            event_key=event_key,
            payload={"started_by_user_id": started_by_user_id},
            rule_id=rule_id,
            started_by_user_id=started_by_user_id,
            start_source="manual",
        )
    except IntegrityError as exc:
        raise ValueError(
            "Ya hay una ejecución de este flujo en curso para este lead. "
            "Esperá a que termine o cancelala antes de iniciar otra."
        ) from exc
    if not created:
        raise ValueError("No se pudo iniciar el flujo: verifica que el lead exista")
    _wake.set()

    async with get_sessionmaker()() as session:
        execution_id = await session.scalar(
            select(AutomationExecution.id).where(
                AutomationExecution.rule_id == rule_id,
                AutomationExecution.event_key == event_key,
            )
        )
    execution = await get_automation_execution(execution_id) if execution_id else None
    if execution is None:
        raise ValueError("No se pudo recuperar la ejecución iniciada")
    return execution
