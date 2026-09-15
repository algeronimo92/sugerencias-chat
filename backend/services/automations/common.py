import asyncio
import unicodedata

from domain_types import (
    AutomationActionType,
    AutomationBuilderMode,
    AutomationExecutionStatus,
    AutomationRecipient,
    FlowConditionType,
    FlowHandle,
    FlowNodeType,
    TaskPriority,
    TaskType,
)
from services.automation_rules import flow_indexes, render_variables, unknown_variables
from services.template_delivery import MEDIA_CAPTION_MAX_LENGTH

AUTOMATION_POLL_SECONDS = 10
MAX_ACTIONS = 10
# Estados no terminales de una ejecución: el flujo sigue "activo" sobre el
# lead. El resto (completed/failed/skipped) ya terminó.
ACTIVE_EXECUTION_STATUSES = {
    AutomationExecutionStatus.SCHEDULED,
    AutomationExecutionStatus.RUNNING,
    AutomationExecutionStatus.PAUSED,
}
# Cuántas ejecuciones vencidas corren en paralelo por ciclo del watcher.
MAX_CONCURRENT_EXECUTIONS = 5
# Veces máximas que una ejecución RUNNING puede recuperarse de quedar
# atascada (crash, reinicio del backend) antes de marcarla failed — no cuenta
# las reanudaciones normales de una pausa (wait/wait_any), solo las
# recuperaciones que hace _release_stale_executions.
MAX_EXECUTION_ATTEMPTS = 3
# Un flujo visual legítimo (varias llamadas a Evolution API de 30-60s) puede
# superar los 10 minutos; con menos margen se re-agendaría una ejecución viva.
STALE_EXECUTION_MINUTES = 15
# Cuando una regla alcanza su max_executions_per_hour, las ejecuciones que
# quedan afuera del cupo se re-agendan este tiempo después en vez de perderse.
RATE_LIMIT_RETRY_MINUTES = 10
# Las reglas de "sin responder" solo miran chats con actividad dentro de los
# minutos configurados más esta gracia (3 días): activar una regla no debe
# disparar contra todo el historial de conversaciones viejas.
OVERDUE_LOOKBACK_GRACE_MINUTES = 4320
# Quién congeló una ejecución (columna pause_scope): pausar el lead entero o el
# vendedor pausando esa sola desde el panel del chat. Reanudar el lead solo
# descongela las primeras; NULL (pausas anteriores a la columna) cuenta como
# LEAD. Ver pause_lead_executions / pause_automation_execution.
PAUSE_SCOPE_LEAD = "lead"
PAUSE_SCOPE_EXECUTION = "execution"
ACTION_TYPES = frozenset(AutomationActionType)
FLOW_NODE_TYPES = frozenset(FlowNodeType)
FLOW_CONDITION_TYPES = frozenset(FlowConditionType)
FLOW_HANDLES = frozenset(FlowHandle)
AUTOMATION_RECIPIENTS = frozenset(AutomationRecipient)
TASK_TYPES = frozenset(TaskType)
TASK_PRIORITIES = frozenset(TaskPriority)
MAX_FLOW_NODES = 50
MAX_FLOW_EDGES = 80
MAX_WHATSAPP_TEXT_LENGTH = 4096
MAX_MEDIA_CAPTION_LENGTH = MEDIA_CAPTION_MAX_LENGTH
# Único texto del fallo por ventana cerrada. La notificación lo acompaña con
# SERVICE_WINDOW_ERROR_CODE para que el frontend ofrezca la autorización sin
# tener que reconocer la frase.
SERVICE_WINDOW_CLOSED_ERROR = "No se envió WhatsApp porque la ventana de 24 horas está cerrada"
SERVICE_WINDOW_ERROR_CODE = "service_window_closed"
MAX_REACTION_LENGTH = 16
CONVERSATION_STATES = frozenset({"open", "closed"})
# Tope de conversaciones que cierra por inactividad cada barrido. Con el
# watcher pasando cada minuto alcanza de sobra, y acota el trabajo del primer
# ciclo después de activar el ajuste sobre un historial viejo.
MAX_AUTO_CLOSE_PER_SWEEP = 200
MAX_MESSAGE_CONDITION_LENGTH = 500
MAX_CONDITION_GROUPS = 10
MAX_CONDITIONS_PER_GROUP = 10
MAX_CONDITIONS_PER_NODE = 30

# Los triggers de los routers lo activan para que watch_automations procese la
# cola de inmediato sin bloquear la request HTTP del usuario (una acción
# send_template puede tardar hasta 30s esperando a Evolution API).
_wake = asyncio.Event()

_render = render_variables
_unknown_variables = unknown_variables


def _ts(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


def _wait_seconds(data: dict) -> int:
    """Segundos de espera de un nodo Wait. Con compatibilidad hacia atrás:
    los flujos publicados antes de dividir la espera en horas/minutos/
    segundos solo tienen "minutes" en su `flow_definition` guardada, y esa
    definición vieja no se reescribe sola — solo al volver a publicar."""
    seconds = data.get("seconds")
    if seconds is not None:
        return int(seconds)
    return int(data.get("minutes") or 0) * 60


def _rule_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "trigger_type": row["trigger_type"],
        "trigger_config": row["trigger_config"] or {},
        "conditions": row["conditions"] or {},
        "actions": row["actions"] or [],
        "builder_mode": row["builder_mode"] or AutomationBuilderMode.SIMPLE,
        "flow_definition": row["flow_definition"] or {},
        "published_flow_definition": row["published_flow_definition"],
        "flow_version": row["flow_version"] or 0,
        "delay_minutes": row["delay_minutes"],
        "max_executions_per_hour": row["max_executions_per_hour"],
        "is_active": row["is_active"],
        "visible_to_sellers": bool(row["visible_to_sellers"]),
        "created_by_user_id": row["created_by_user_id"],
        "created_by_name": row["created_by_name"],
        "execution_count": int(row["execution_count"] or 0),
        "last_execution_at": _ts(row["last_execution_at"]),
        "last_execution_status": row["last_execution_status"],
        "created_at": _ts(row["created_at"]),
        "updated_at": _ts(row["updated_at"]),
    }


def _execution_dict(row) -> dict:
    return {
        "id": row["id"],
        "rule_id": row["rule_id"],
        "rule_name": row["rule_name"],
        "rule_deleted": bool(row["rule_deleted"]),
        "lead_id": row["lead_id"],
        "lead_name": row["lead_name"],
        "trigger_type": row["trigger_type"],
        "status": row["status"],
        "scheduled_for": _ts(row["scheduled_for"]),
        "paused_at": _ts(row["paused_at"]),
        "pause_scope": row["pause_scope"],
        "started_at": _ts(row["started_at"]),
        "finished_at": _ts(row["finished_at"]),
        "action_results": row["action_results"] or [],
        "flow_state": row["flow_state"] or {},
        "error": row["error"],
        "created_at": _ts(row["created_at"]),
        "start_source": row["start_source"] or "system",
        "started_by_user_id": row["started_by_user_id"],
        "started_by_name": row["started_by_name"],
        "window_override_at": _ts(row["window_override_at"]),
        "window_override_by_name": row["window_override_by_name"],
    }


_flow_indexes = flow_indexes


def _normalize_reply_text(value: str) -> str:
    """Trim, espacios estables, minúsculas y sin acentos para comparar texto
    de cliente sin depender de presentación, mayúsculas o tildes."""
    compact = " ".join(value.strip().lower().split())
    decomposed = unicodedata.normalize("NFKD", compact)
    return "".join(char for char in decomposed if not unicodedata.combining(char))
