"""Interfaz estable para rutas, integraciones y arranque de automatizaciones.

Los consumidores externos solo necesitan operaciones de reglas, ejecución,
eventos y supervisión; el resto del motor es interno.
"""

from app.modules.automations.application.management import (
    cancel_automation_execution,
    create_automation_rule,
    create_visual_flow,
    delete_automation_rule,
    duplicate_automation_rule,
    pause_automation_execution,
    pause_lead_executions,
    publish_visual_flow,
    restore_flow_version,
    resume_automation_execution,
    resume_lead_executions,
    retry_automation_execution,
    save_visual_flow,
    start_manual_flow_execution,
    update_automation_rule,
)
from app.modules.automations.application.simulation import simulate_visual_flow
from app.modules.automations.application.triggers import trigger_inbound_message, trigger_lead_created
from app.modules.automations.application.validation import validate_automation_rule
from app.modules.automations.infrastructure.worker import backfill_automation_state, watch_automations
from app.modules.automations.queries import (
    get_automation_execution,
    get_automation_rule,
    list_automation_executions,
    list_automation_rules,
    list_flow_versions,
    list_manual_flows,
)
