"""El worker de automatizaciones: el bucle que corre lo vencido y los
barridos que descubren lo que ningún evento avisó.

Los barridos son la red de seguridad del camino por eventos: un mensaje que
entró por fuera del webhook, una tarea que venció, una espera que ya tiene
respuesta o una ejecución que quedó colgada por un reinicio. Detectan con SQL
y delegan en la aplicación (``triggers`` y ``engine``).
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from time import monotonic

from sqlalchemy import DateTime, cast, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.events import publish
from app.core.time_format import iso_utc
from app.db.models.automations import AutomationExecution, AutomationFlowVersion, AutomationRule
from app.db.models.conversations import WspMessage
from app.db.models.leads import Lead, LeadActivity
from app.db.models.tasks import LeadTask
from app.db.uow import session_scope
from app.integrations.meta_webhook.projection import reply_identifier
from app.modules.automations.domain.types import AutomationBuilderMode, AutomationExecutionStatus, AutomationTrigger, WaitAnyConditionKind
from app.modules.tasks.ports.types import TaskStatus
from app.modules.automations.application.engine import process_due_automation_executions
from app.modules.automations.application.triggers import (
    backfill_customer_response_deadlines,
    schedule_automation_event,
)
from app.modules.automations.domain.events import AutomationsChanged, ExecutionFailed
from app.modules.automations.domain.limits import (
    AUTOMATION_POLL_SECONDS,
    MAX_AUTO_CLOSE_PER_SWEEP,
    MAX_EXECUTION_ATTEMPTS,
    OVERDUE_LOOKBACK_GRACE_MINUTES,
    STALE_EXECUTION_MINUTES,
)
from app.modules.automations.domain.replies import (
    MAX_REPLIES_SCANNED,
    NON_REPLY_MESSAGE_TYPES,
    SEEN_META_STATUS,
    awaiting_kinds,
    classify_customer_reply,
    match_question_button,
    resume_branch,
)
from app.modules.automations.infrastructure import wakeup
from app.modules.leads.public import Actor, update_lead
from app.modules.platform.ports.settings_service import get_effective

logger = logging.getLogger(__name__)


async def _discover_recent_inbound_messages() -> None:
    since = datetime.now(timezone.utc) - timedelta(minutes=5)
    async with session_scope() as session:
        has_rules = await session.scalar(select(AutomationRule.id).where(
            AutomationRule.is_active.is_(True),
            AutomationRule.trigger_type.in_([
                AutomationTrigger.MESSAGE_RECEIVED,
                AutomationTrigger.LEAD_CREATED,
                AutomationTrigger.CONVERSATION_STARTED,
            ]),
        ).limit(1))
        if not has_rules:
            return
        rows = (await session.execute(
            select(
                WspMessage.id,
                WspMessage.wa_message_id,
                WspMessage.chat_id,
                WspMessage.content,
                WspMessage.message_type,
                WspMessage.message_subtype,
                WspMessage.provider_payload,
            ).where(
                WspMessage.sender == "cliente",
                WspMessage.sent_at >= since,
                WspMessage.message_type.not_in(NON_REPLY_MESSAGE_TYPES),
            ).order_by(WspMessage.sent_at.asc(), WspMessage.id.asc()).limit(200)
        )).mappings().all()
    for row in rows:
        await schedule_automation_event(
            AutomationTrigger.MESSAGE_RECEIVED,
            row["chat_id"],
            f"message:{row['wa_message_id'] or row['id']}",
            {
                "message_id": str(row["wa_message_id"] or row["id"]),
                "content": row["content"],
                "message_type": row["message_type"],
                "message_subtype": row["message_subtype"],
                "reply_id": reply_identifier(row["message_type"], row["provider_payload"]),
            },
        )

    # La apertura queda auditada en la misma transacción que cambia el lead.
    # Si el webhook cayó después de ese commit pero antes de programar el
    # flujo, este barrido reconstruye el evento sin volver a abrir ni duplicar.
    async with session_scope() as session:
        conversation_rows = (await session.execute(
            select(
                LeadActivity.lead_id,
                LeadActivity.new_value,
                LeadActivity.metadata_,
                LeadActivity.created_at,
            ).where(
                LeadActivity.event_type == AutomationTrigger.CONVERSATION_STARTED,
                LeadActivity.created_at >= since,
            ).order_by(LeadActivity.created_at.asc(), LeadActivity.id.asc()).limit(200)
        )).mappings().all()
    for row in conversation_rows:
        new_value = row["new_value"] or {}
        metadata = row["metadata_"] or {}
        version = int(new_value.get("conversacion_version") or 0)
        if version <= 0:
            continue
        await schedule_automation_event(
            AutomationTrigger.CONVERSATION_STARTED,
            row["lead_id"],
            f"conversation:{row['lead_id']}:{version}",
            {
                "message_id": str(metadata.get("message_id") or ""),
                "content": metadata.get("content"),
                "conversation_version": version,
                "conversation_opened_at": iso_utc(row["created_at"]),
            },
        )


async def _discover_wait_any_replies() -> None:
    """Reanuda ejecuciones pausadas en un bloque Pausa (wait_any, condición
    "hasta recibir mensaje" o "hasta que se reproduce lo enviado") o Pregunta
    (question): si el lead escribió después de entrar a la espera, o si el
    mensaje que se vigila ya figura leído en Meta, adelanta `scheduled_for` a
    ahora y marca `resume_reason` para que el motor siga por
    esa rama en vez de la del timer. Análoga a
    `_discover_recent_inbound_messages`, pero para ejecuciones que ya están
    corriendo (no dispara ejecuciones nuevas)."""
    # El filtro de abajo es lo que hace barato correr esto seguido: sin él la
    # query devolvía todas las ejecuciones en espera y había que preguntar por
    # cada una si el cliente ya había contestado, una consulta por ejecución.
    # Con el EXISTS vuelven solo las que tienen algo que reanudar, que en
    # cualquier momento son unas pocas. De paso saca el hambre que causaba el
    # limit: antes, con más de 200 esperando, las del fondo no se miraban nunca
    # y salían por la rama del timeout como si el cliente no hubiera escrito.
    waiting_since = cast(
        AutomationExecution.flow_state["waiting_since"].astext, DateTime(timezone=True)
    )
    hay_respuesta = exists(
        select(1).where(
            WspMessage.chat_id == AutomationExecution.lead_id,
            WspMessage.sender == "cliente",
            WspMessage.sent_at > waiting_since,
        )
    )
    lo_vigilado_se_vio = exists(
        select(1).where(
            WspMessage.wa_message_id == AutomationExecution.flow_state["watching_message_id"].astext,
            WspMessage.meta_status == SEEN_META_STATUS,
        )
    )
    async with session_scope() as session:
        waiting = (await session.execute(
            select(AutomationExecution.id, AutomationExecution.lead_id, AutomationExecution.flow_state)
            .where(
                AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
                or_(
                    AutomationExecution.flow_state.has_key("awaiting"),
                    AutomationExecution.flow_state["awaiting_message"].astext == "true",
                    AutomationExecution.flow_state["watching_message_id"].astext.isnot(None),
                ),
                or_(hay_respuesta, lo_vigilado_se_vio),
            )
            .order_by(AutomationExecution.id)
            .limit(200)
        )).all()
    resumed = False
    for execution_id, lead_id, flow_state in waiting:
        waiting_since = flow_state.get("waiting_since") if flow_state else None
        if not lead_id or not waiting_since:
            continue
        since = datetime.fromisoformat(waiting_since)
        resume_reason = None
        reply_context = None
        awaiting = awaiting_kinds(flow_state)
        async with session_scope() as session:
            if awaiting:
                replies = (await session.execute(
                    select(
                        WspMessage.id,
                        WspMessage.wa_message_id,
                        WspMessage.message_type,
                        WspMessage.message_subtype,
                        WspMessage.provider_payload,
                        WspMessage.content,
                        WspMessage.analysis,
                    ).where(
                        WspMessage.chat_id == lead_id,
                        WspMessage.sender == "cliente",
                        WspMessage.sent_at > since,
                    ).order_by(WspMessage.sent_at.asc(), WspMessage.id.asc())
                    .limit(MAX_REPLIES_SCANNED)
                )).mappings().all()
                question_buttons = flow_state.get("question_buttons")
                for reply in replies:
                    kind = classify_customer_reply(reply["message_type"])
                    if kind is None:
                        # Un aviso de sistema no es una respuesta del
                        # cliente: se sigue esperando.
                        continue
                    reply_id = reply_identifier(reply["message_type"], reply["provider_payload"])
                    if question_buttons:
                        branch = match_question_button(
                            question_buttons,
                            reply_id,
                            reply["content"],
                            kind,
                            WaitAnyConditionKind.MEDIA_RECEIVED in awaiting,
                        )
                    else:
                        branch = resume_branch(kind, awaiting)
                        if branch is None:
                            continue
                    analysis = reply["analysis"] if isinstance(reply["analysis"], dict) else {}
                    reply_context = {
                        "message_id": str(reply["wa_message_id"] or reply["id"]),
                        "content": reply["content"],
                        "message_type": reply["message_type"],
                        "message_subtype": reply["message_subtype"],
                        "reply_id": reply_id,
                        # La descripción que la IA generó del adjunto, que es
                        # sobre lo que puede condicionar el flujo más adelante.
                        "analysis_summary": analysis.get("summary"),
                    }
                    resume_reason = branch
                    break
            watching_message_id = flow_state.get("watching_message_id")
            if resume_reason is None and watching_message_id:
                status = await session.scalar(
                    select(WspMessage.meta_status).where(WspMessage.wa_message_id == watching_message_id)
                )
                if status == SEEN_META_STATUS:
                    resume_reason = WaitAnyConditionKind.MEDIA_PLAYED
            if resume_reason is None:
                continue
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id,
                AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
            ).values(
                scheduled_for=datetime.now(timezone.utc),
                flow_state={
                    **flow_state,
                    "resume_reason": resume_reason,
                    **({"message_context": reply_context} if reply_context else {}),
                },
            ))
            resumed = True
    if resumed:
        wakeup.wake()


async def _discover_timed_events() -> None:
    """Descubre únicamente eventos externos que todavía no crean su deadline.

    ``customer_response_overdue`` no aparece aquí: se programa al insertar cada
    mensaje del vendedor y, por tanto, no necesita recorrer chats por minuto.
    """
    async with session_scope() as session:
        rules = (await session.execute(select(AutomationRule).where(
            AutomationRule.is_active.is_(True),
            AutomationRule.trigger_type.in_([
                AutomationTrigger.SELLER_RESPONSE_OVERDUE,
                AutomationTrigger.TASK_DUE,
            ]),
        ))).scalars().all()
    for rule in rules:
        if rule.trigger_type == AutomationTrigger.TASK_DUE:
            async with session_scope() as session:
                tasks = (await session.execute(select(
                    LeadTask.id, LeadTask.lead_id, LeadTask.assigned_user_id, LeadTask.title,
                    LeadTask.due_at,
                ).where(
                    LeadTask.status == TaskStatus.PENDING,
                    LeadTask.due_at <= datetime.now(timezone.utc),
                ).limit(200))).mappings().all()
            for task in tasks:
                # Clave anclada al vencimiento: editar título o prioridad de la
                # tarea no re-dispara la regla; mover la fecha límite sí.
                await schedule_automation_event(
                    AutomationTrigger.TASK_DUE,
                    task["lead_id"],
                    f"task:{task['id']}:{iso_utc(task['due_at'])}", {
                        "task_id": task["id"],
                        "assigned_user_id": task["assigned_user_id"],
                        "title": task["title"],
                        "due_at": iso_utc(task["due_at"]),
                    }, rule.id
                )
            continue
        expected_sender = "cliente"
        now = datetime.now(timezone.utc)
        minutes = int((rule.trigger_config or {}).get("minutes", 1))
        threshold = now - timedelta(minutes=minutes)
        # Solo silencios recientes: chats sin actividad desde antes del
        # lookback no disparan — activar una regla no puede provocar un envío
        # masivo a conversaciones viejas. La cota además permite que la query
        # use idx_wsp_messages_sent_at en vez de recorrer toda la tabla.
        lookback = now - timedelta(minutes=minutes + OVERDUE_LOOKBACK_GRACE_MINUTES)
        last_message = select(
            WspMessage.id, WspMessage.chat_id, WspMessage.sender, WspMessage.sent_at,
        ).where(WspMessage.sent_at >= lookback).order_by(
            WspMessage.chat_id, WspMessage.sent_at.desc(), WspMessage.id.desc()
        ).distinct(WspMessage.chat_id).subquery()
        async with session_scope() as session:
            rows = (await session.execute(select(last_message).where(
                last_message.c.sender == expected_sender,
                last_message.c.sent_at <= threshold,
            ).limit(500))).mappings().all()
        for row in rows:
            await schedule_automation_event(
                AutomationTrigger(rule.trigger_type),
                row["chat_id"],
                f"overdue:{row['id']}",
                {"last_message_id": str(row["id"]), "last_sender": row["sender"], "last_message_at": iso_utc(row["sent_at"])},
                rule.id,
            )


def _auto_close_hours(raw: str) -> int:
    """Horas configuradas para el cierre automático. 0 = desactivado, que es
    también lo que devuelve cualquier valor inválido: un ajuste mal tipeado no
    puede terminar cerrando conversaciones cada minuto."""
    try:
        hours = int(float(str(raw).strip()))
    except (TypeError, ValueError):
        return 0
    return hours if hours > 0 else 0


async def _auto_close_idle_conversations() -> int:
    """Cierra las conversaciones que llevan N horas sin ningún mensaje.

    Cuenta el último mensaje de cualquiera de los dos lados: un seguimiento del
    vendedor reinicia el reloj igual que una respuesta del cliente. Si el chat
    todavía no tiene mensajes se mide desde que la conversación se abrió.

    Respeta la pausa del lead, igual que el resto de lo que hace el sistema:
    si el vendedor pausó la automatización para atenderlo a mano, es él quien
    decide cuándo cerrar.

    El cierre pasa por `update_lead` en vez de un UPDATE directo para que
    quede la actividad `conversation_closed` en el historial y se complete
    `conversacion_cerrada_at`, igual que cuando lo cierra una persona.
    """
    hours = _auto_close_hours(await get_effective("conversation_auto_close_hours"))
    if not hours:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    last_message_at = (
        select(func.max(WspMessage.sent_at))
        .where(WspMessage.chat_id == Lead.id)
        .correlate(Lead)
        .scalar_subquery()
    )
    async with session_scope() as session:
        lead_ids = (await session.execute(
            select(Lead.id).where(
                Lead.conversacion_abierta.is_(True),
                Lead.automatizacion_pausada.is_(False),
                func.coalesce(last_message_at, Lead.conversacion_abierta_at) <= cutoff,
            ).limit(MAX_AUTO_CLOSE_PER_SWEEP)
        )).scalars().all()
    closed = 0
    for lead_id in lead_ids:
        try:
            await update_lead(lead_id, {"conversacion_abierta": False}, actor=Actor.system())
        except Exception:
            logger.exception("No se pudo cerrar por inactividad la conversación de %s", lead_id)
            continue
        closed += 1
    if closed:
        logger.info("Cerradas %s conversaciones tras %s horas sin mensajes", closed, hours)
    return closed


async def _release_stale_executions() -> None:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=STALE_EXECUTION_MINUTES)
    async with session_scope() as session:
        # Las que ya agotaron sus reclamos no se re-agendan más: quedan failed
        # para que el fallo sea visible en vez de reintentarse para siempre.
        exhausted = (await session.execute(update(AutomationExecution).where(
            AutomationExecution.status == AutomationExecutionStatus.RUNNING,
            AutomationExecution.started_at < cutoff,
            AutomationExecution.attempts >= MAX_EXECUTION_ATTEMPTS,
        ).values(
            status=AutomationExecutionStatus.FAILED,
            error="Interrumpida demasiadas veces; no se volverá a reintentar",
            finished_at=now,
        ).returning(AutomationExecution.id))).scalars().all()
        released = (await session.execute(update(AutomationExecution).where(
            AutomationExecution.status == AutomationExecutionStatus.RUNNING,
            AutomationExecution.started_at < cutoff,
        ).values(
            status=AutomationExecutionStatus.SCHEDULED,
            started_at=None,
            error="Reintentando una ejecución interrumpida",
            attempts=AutomationExecution.attempts + 1,
        ).returning(AutomationExecution.id))).scalars().all()
        failed = (await session.execute(
            select(AutomationExecution, AutomationRule)
            .join(AutomationRule, AutomationRule.id == AutomationExecution.rule_id)
            .where(AutomationExecution.id.in_(exhausted))
        )).all() if exhausted else []
    # El frontend ya no sondea las ejecuciones con el WebSocket conectado:
    # todo cambio de estado tiene que avisarse.
    if exhausted or released:
        await publish(AutomationsChanged())
    for execution, rule in failed:
        await publish(ExecutionFailed(
            execution_id=execution.id,
            rule_id=rule.id,
            rule_name=rule.name,
            rule_owner_id=rule.created_by_user_id,
            lead_id=execution.lead_id,
            error=execution.error or "",
        ))


async def backfill_automation_state() -> None:
    """Migraciones de datos idempotentes que corren al arranque.

    1. Copia las definiciones publicadas a automation_flow_versions — las
       instalaciones previas solo las tenían embebidas en la regla y en el
       flow_state de cada ejecución.
    2. Reescribe las claves de eventos task_due del formato viejo
       task:{id}:{updated_at} al nuevo task:{id}:{due_at}, para que el deploy
       no re-dispare automatizaciones de tareas ya procesadas.
    3. Crea una vez los deadlines recientes de ``customer_response_overdue``;
       después los mensajes los mantienen sin ningún barrido periódico.
    """
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        published_rules = (await session.execute(select(
            AutomationRule.id, AutomationRule.flow_version, AutomationRule.published_flow_definition,
        ).where(
            AutomationRule.builder_mode == AutomationBuilderMode.VISUAL,
            AutomationRule.published_flow_definition.is_not(None),
            AutomationRule.flow_version > 0,
        ))).mappings().all()
        for rule in published_rules:
            await session.execute(pg_insert(AutomationFlowVersion).values(
                rule_id=rule["id"],
                version=rule["flow_version"],
                definition=rule["published_flow_definition"],
                created_at=now,
            ).on_conflict_do_nothing(
                index_elements=[AutomationFlowVersion.rule_id, AutomationFlowVersion.version]
            ))

        rows = (await session.execute(
            select(AutomationExecution.id, AutomationExecution.rule_id, AutomationExecution.event_key).where(
                AutomationExecution.trigger_type == AutomationTrigger.TASK_DUE
            ).order_by(AutomationExecution.created_at.desc(), AutomationExecution.id.desc())
        )).mappings().all()
        task_ids = {
            int(row["event_key"].split(":")[1])
            for row in rows
            if row["event_key"].startswith("task:") and row["event_key"].split(":")[1].isdigit()
        }
        due_map: dict[int, datetime] = {}
        if task_ids:
            due_map = dict((await session.execute(
                select(LeadTask.id, LeadTask.due_at).where(LeadTask.id.in_(task_ids))
            )).all())
        existing_keys = {(row["rule_id"], row["event_key"]) for row in rows}
        migrated: set[tuple[int, int]] = set()
        for row in rows:  # ordenadas de más reciente a más antigua
            parts = row["event_key"].split(":")
            if len(parts) < 3 or parts[0] != "task" or not parts[1].isdigit():
                continue
            task_id = int(parts[1])
            if (row["rule_id"], task_id) in migrated:
                continue
            migrated.add((row["rule_id"], task_id))
            due_at = due_map.get(task_id)
            if due_at is None:
                continue
            new_key = f"task:{task_id}:{iso_utc(due_at)}"
            if new_key == row["event_key"] or (row["rule_id"], new_key) in existing_keys:
                continue
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == row["id"]
            ).values(event_key=new_key))
            existing_keys.add((row["rule_id"], new_key))
        customer_deadline_rule_ids = (await session.execute(select(
            AutomationRule.id
        ).where(
            AutomationRule.is_active.is_(True),
            AutomationRule.trigger_type == AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
        ))).scalars().all()
    for rule_id in customer_deadline_rule_ids:
        await backfill_customer_response_deadlines(rule_id)


async def watch_automations() -> None:
    next_housekeeping_at = 0.0
    while True:
        try:
            now_mono = monotonic()
            if now_mono >= next_housekeeping_at:
                await _release_stale_executions()
                await _discover_recent_inbound_messages()
                await _discover_timed_events()
                await _auto_close_idle_conversations()
                next_housekeeping_at = now_mono + 60.0
            # Fuera del bloque de housekeeping: un cliente que toca un botón
            # despierta el bucle por `wakeup`, y esperar hasta un minuto a que
            # el bot conteste es la diferencia entre parecer un bot y parecer
            # un cuelgue. Es una sola query, y filtrada.
            await _discover_wait_any_replies()
            await process_due_automation_executions()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error al procesar automatizaciones")
        # Duerme hasta el próximo ciclo o hasta que un trigger lo despierte —
        # así los eventos de los routers se procesan al instante sin que la
        # request HTTP tenga que esperar a las acciones.
        await wakeup.sleep(AUTOMATION_POLL_SECONDS)
