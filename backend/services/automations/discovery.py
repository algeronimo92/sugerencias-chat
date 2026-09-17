import asyncio
import logging
from datetime import datetime, timedelta, timezone
from time import monotonic

from sqlalchemy import DateTime, cast, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import (
    AutomationExecution,
    AutomationFlowVersion,
    AutomationRule,
    Lead,
    LeadActivity,
    LeadTask,
    WspMessage,
)
from db.session import get_sessionmaker
from domain_types import (
    AutomationBuilderMode,
    AutomationExecutionStatus,
    AutomationTrigger,
    QuestionHandle,
    TaskStatus,
    WaitAnyConditionKind,
)
from services.automation_rules import classify_customer_reply
from services.automations.common import (
    AUTOMATION_POLL_SECONDS,
    MAX_AUTO_CLOSE_PER_SWEEP,
    MAX_EXECUTION_ATTEMPTS,
    OVERDUE_LOOKBACK_GRACE_MINUTES,
    STALE_EXECUTION_MINUTES,
    _normalize_reply_text,
    _wake,
)
from services.automations.engine import (
    _notify_execution_failure,
    process_due_automation_executions,
)
from services.automations.scheduler import (
    _backfill_customer_response_deadlines,
    schedule_automation_event,
)
from services.db_service import update_lead
from services.settings_service import get_effective
from services.ws_manager import manager
from services.time_format import iso_utc

logger = logging.getLogger(__name__)


async def _discover_recent_inbound_messages() -> None:
    since = datetime.now(timezone.utc) - timedelta(minutes=5)
    async with get_sessionmaker()() as session:
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
            select(WspMessage.id, WspMessage.wa_message_id, WspMessage.chat_id, WspMessage.content).where(
                WspMessage.sender == "cliente", WspMessage.sent_at >= since
            ).order_by(WspMessage.sent_at.asc(), WspMessage.id.asc()).limit(200)
        )).mappings().all()
    for row in rows:
        await schedule_automation_event(
            AutomationTrigger.MESSAGE_RECEIVED,
            row["chat_id"],
            f"message:{row['wa_message_id'] or row['id']}",
            {"message_id": str(row["wa_message_id"] or row["id"]), "content": row["content"]},
        )

    # La apertura queda auditada en la misma transacción que cambia el lead.
    # Si el webhook cayó después de ese commit pero antes de programar el
    # flujo, este barrido reconstruye el evento sin volver a abrir ni duplicar.
    async with get_sessionmaker()() as session:
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


def _match_question_button(
    buttons: list[dict],
    message_type: str | None,
    content: str | None,
    payload: dict | None,
    kind: str | None = None,
    has_media_handle: bool = False,
) -> str:
    """Resuelve a qué botón corresponde la respuesta del cliente: por
    `selected_id` si tocó un botón nativo, si no por número de posición o por
    el texto del botón (el fallback de texto numerado usa exactamente ese
    esquema); si no matchea nada, "otra respuesta".

    Una foto se resuelve antes de mirar texto y sale por su propia salida:
    9 de cada 10 llegan sin caption, así que por texto no matchea nada y
    terminaría en "otra respuesta" — que es justamente la rama del cliente
    que NO mandó lo que se le pidió. Si el flujo no conectó esa salida,
    conserva el comportamiento anterior.
    """
    if kind == WaitAnyConditionKind.MEDIA_RECEIVED and has_media_handle:
        return QuestionHandle.MEDIA
    if message_type == "interactive" and isinstance(payload, dict):
        selected_id = payload.get("selected_id")
        if selected_id and any(button["id"] == selected_id for button in buttons):
            return selected_id
    normalized = _normalize_reply_text(content or "")
    if normalized.isdigit():
        index = int(normalized) - 1
        if 0 <= index < len(buttons):
            return buttons[index]["id"]
    for button in buttons:
        if _normalize_reply_text(button["label"]) == normalized:
            return button["id"]
    return QuestionHandle.OTHER


# Cuántos mensajes del cliente se miran por ejecución al buscar el que reanuda.
# Sólo se necesita mirar más de uno cuando los primeros son ruido (el sobre de
# un álbum) o no satisfacen ninguna rama declarada (un "ahorita te la mando"
# en un bloque que espera únicamente la foto).
MAX_REPLIES_SCANNED = 20


def _awaiting_kinds(flow_state: dict) -> set[str]:
    """Qué clases de respuesta reanudan este bloque.

    `awaiting_message: true` es el formato anterior y equivale a "cualquier
    mensaje": se sigue leyendo para que las ejecuciones que ya estaban
    esperando cuando se desplegó esto terminen sin quedarse colgadas.
    """
    awaiting = flow_state.get("awaiting")
    if isinstance(awaiting, list):
        return {kind for kind in awaiting if isinstance(kind, str)}
    return {WaitAnyConditionKind.MESSAGE} if flow_state.get("awaiting_message") else set()


def _resume_branch(kind: str, awaiting: set[str]) -> str | None:
    """Por qué rama sale una respuesta ya clasificada, o None si el bloque no
    declaró ninguna que la acepte y hay que seguir esperando.

    `message` sigue siendo el cajón de sastre —una foto también es un mensaje,
    y un bloque que sólo espera "mensaje" tiene que reanudar con ella igual que
    antes—, pero pierde contra `media_received` cuando el flujo se tomó el
    trabajo de dibujar esa rama. Al revés no: un bloque que espera únicamente
    la foto NO se despierta con un "ahorita te la mando", que es justo el
    motivo por el que existe.
    """
    if kind == WaitAnyConditionKind.MEDIA_RECEIVED and WaitAnyConditionKind.MEDIA_RECEIVED in awaiting:
        return WaitAnyConditionKind.MEDIA_RECEIVED
    if WaitAnyConditionKind.MESSAGE in awaiting:
        return WaitAnyConditionKind.MESSAGE
    return None


async def _discover_wait_any_replies() -> None:
    """Reanuda ejecuciones pausadas en un bloque Pausa (wait_any, condición
    "hasta recibir mensaje" o "hasta que se reproduce lo enviado") o Pregunta
    (question): si el lead escribió después de entrar a la espera, o si el
    mensaje que se vigila ya quedó en READ/PLAYED, adelanta `scheduled_for` a
    ahora y marca `resume_reason` para que `_run_visual_execution` siga por
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
            WspMessage.status.in_(("READ", "PLAYED")),
        )
    )
    async with get_sessionmaker()() as session:
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
        awaiting = _awaiting_kinds(flow_state)
        async with get_sessionmaker()() as session:
            if awaiting:
                replies = (await session.execute(
                    select(
                        WspMessage.id,
                        WspMessage.wa_message_id,
                        WspMessage.message_type,
                        WspMessage.content,
                        WspMessage.payload,
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
                    kind = classify_customer_reply(reply["message_type"], reply["payload"])
                    if kind is None:
                        # Ruido de WhatsApp (el sobre de un álbum, una acción
                        # cifrada): no es una respuesta, se sigue esperando.
                        continue
                    if question_buttons:
                        branch = _match_question_button(
                            question_buttons,
                            reply["message_type"],
                            reply["content"],
                            reply["payload"],
                            kind,
                            WaitAnyConditionKind.MEDIA_RECEIVED in awaiting,
                        )
                    else:
                        branch = _resume_branch(kind, awaiting)
                        if branch is None:
                            continue
                    analysis = reply["analysis"] if isinstance(reply["analysis"], dict) else {}
                    reply_context = {
                        "message_id": str(reply["wa_message_id"] or reply["id"]),
                        "content": reply["content"],
                        "message_type": reply["message_type"],
                        # La descripción que la IA generó del adjunto, que es
                        # sobre lo que puede condicionar el flujo más adelante.
                        "analysis_summary": analysis.get("summary"),
                    }
                    resume_reason = branch
                    break
            watching_message_id = flow_state.get("watching_message_id")
            if resume_reason is None and watching_message_id:
                status = await session.scalar(
                    select(WspMessage.status).where(WspMessage.wa_message_id == watching_message_id)
                )
                if status in ("READ", "PLAYED"):
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
            await session.commit()
            resumed = True
    if resumed:
        _wake.set()


async def _discover_timed_events() -> None:
    """Descubre únicamente eventos externos que todavía no crean su deadline.

    ``customer_response_overdue`` no aparece aquí: se programa al insertar cada
    mensaje del vendedor y, por tanto, no necesita recorrer chats por minuto.
    """
    async with get_sessionmaker()() as session:
        rules = (await session.execute(select(AutomationRule).where(
            AutomationRule.is_active.is_(True),
            AutomationRule.trigger_type.in_([
                AutomationTrigger.SELLER_RESPONSE_OVERDUE,
                AutomationTrigger.TASK_DUE,
            ]),
        ))).scalars().all()
    for rule in rules:
        if rule.trigger_type == AutomationTrigger.TASK_DUE:
            async with get_sessionmaker()() as session:
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
        async with get_sessionmaker()() as session:
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
    async with get_sessionmaker()() as session:
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
            await update_lead(lead_id, {"conversacion_abierta": False}, "system", None)
        except Exception:
            logger.exception("No se pudo cerrar por inactividad la conversación de %s", lead_id)
            continue
        closed += 1
        await manager.broadcast({
            "type": "chats_updated",
            "chat_id": lead_id,
            "reason": "conversation_closed",
        })
    if closed:
        logger.info("Cerradas %s conversaciones tras %s horas sin mensajes", closed, hours)
    return closed


async def _release_stale_executions() -> None:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=STALE_EXECUTION_MINUTES)
    async with get_sessionmaker()() as session:
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
        await session.execute(update(AutomationExecution).where(
            AutomationExecution.status == AutomationExecutionStatus.RUNNING,
            AutomationExecution.started_at < cutoff,
        ).values(
            status=AutomationExecutionStatus.SCHEDULED,
            started_at=None,
            error="Reintentando una ejecución interrumpida",
            attempts=AutomationExecution.attempts + 1,
        ))
        await session.commit()
    for execution_id in exhausted:
        async with get_sessionmaker()() as session:
            execution = await session.get(AutomationExecution, execution_id)
            rule = await session.get(AutomationRule, execution.rule_id) if execution else None
        if execution and rule:
            await _notify_execution_failure(rule, execution, execution.error or "")


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
    async with get_sessionmaker()() as session:
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
        await session.commit()
    for rule_id in customer_deadline_rule_ids:
        await _backfill_customer_response_deadlines(rule_id)


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
            # despierta el bucle por `_wake`, y esperar hasta un minuto a que
            # el bot conteste es la diferencia entre parecer un bot y parecer
            # un cuelgue. Es una sola query, y filtrada.
            await _discover_wait_any_replies()
            await process_due_automation_executions()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error al procesar automatizaciones")
        # Duerme hasta el próximo ciclo o hasta que un trigger active _wake —
        # así los eventos de los routers se procesan al instante sin que la
        # request HTTP tenga que esperar a las acciones.
        try:
            await asyncio.wait_for(_wake.wait(), timeout=AUTOMATION_POLL_SECONDS)
        except TimeoutError:
            pass
        _wake.clear()
