"""Topes y constantes del motor de automatizaciones.

Los largos de WhatsApp salen del contrato de Meta: la app es nativa de Meta y
ese contrato es parte del lenguaje del dominio (ver la excepción explícita en
``tests/test_layering.py``).
"""

from app.modules.automations.domain.types import AutomationActionType, AutomationExecutionStatus, AutomationRecipient, AutomationTrigger, FlowConditionType, FlowHandle, FlowNodeType
from app.modules.tasks.ports.types import TaskPriority, TaskType
from app.integrations.meta.contract import limit

TRIGGER_TYPES = frozenset(AutomationTrigger)
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
# Un flujo visual legítimo (varias llamadas a Meta de 30-60s) puede
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
MAX_MEDIA_CAPTION_LENGTH = limit("caption")
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
