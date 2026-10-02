"""Interfaz estable para rutas, integraciones y arranque de automatizaciones.

El motor conserva sus archivos internos; los consumidores externos solo
necesitan operaciones de reglas, ejecución, eventos y supervisión.
"""

from app.modules.automations.rules import (
    cancel_automation_execution,
    create_automation_rule,
    delete_automation_rule,
    duplicate_automation_rule,
    get_automation_execution,
    get_automation_rule,
    list_automation_executions,
    list_automation_rules,
    list_manual_flows,
    pause_automation_execution,
    pause_lead_executions,
    resume_automation_execution,
    resume_lead_executions,
    retry_automation_execution,
    start_manual_flow_execution,
    update_automation_rule,
)
from app.modules.automations.flow_versions import (
    create_visual_flow,
    list_flow_versions,
    publish_visual_flow,
    restore_flow_version,
    save_visual_flow,
)
from app.modules.automations.rule_validation import validate_automation_rule
from app.modules.automations.simulation import simulate_visual_flow
from app.modules.automations.scheduler import (
    notify_automations_scheduled,
    trigger_inbound_message,
    trigger_lead_created,
)
from app.modules.automations.discovery import (
    backfill_automation_state,
    watch_automations,
)
