"""Contratos HTTP de automations."""

from typing import Any

from pydantic import BaseModel, Field
from app.modules.automations.domain.types import AutomationBuilderMode, AutomationExecutionStatus, AutomationTrigger, ExecutionErrorCode, ExecutionPauseScope, ExecutionStartSource


class AutomationRuleCreate(BaseModel):
    name: str
    trigger_type: AutomationTrigger
    trigger_config: dict = Field(default_factory=dict)
    conditions: dict = Field(default_factory=dict)
    actions: list[dict] = Field(default_factory=list)
    delay_minutes: int = Field(default=0, ge=0, le=10080)
    max_executions_per_hour: int | None = Field(default=None, ge=1, le=1000)
    is_active: bool = True
    visible_to_sellers: bool = False


class AutomationRuleUpdate(BaseModel):
    name: str | None = None
    trigger_type: AutomationTrigger | None = None
    trigger_config: dict | None = None
    conditions: dict | None = None
    actions: list[dict] | None = None
    delay_minutes: int | None = Field(default=None, ge=0, le=10080)
    max_executions_per_hour: int | None = Field(default=None, ge=1, le=1000)
    is_active: bool | None = None
    visible_to_sellers: bool | None = None


class AutomationRuleItem(BaseModel):
    id: int
    name: str
    trigger_type: AutomationTrigger
    trigger_config: dict
    conditions: dict
    actions: list[dict]
    builder_mode: AutomationBuilderMode = AutomationBuilderMode.SIMPLE
    flow_definition: dict = Field(default_factory=dict)
    published_flow_definition: dict | None = None
    flow_version: int = 0
    delay_minutes: int
    max_executions_per_hour: int | None = None
    is_active: bool
    visible_to_sellers: bool = False
    created_by_user_id: int
    created_by_name: str
    execution_count: int
    last_execution_at: str | None = None
    last_execution_status: AutomationExecutionStatus | None = None
    created_at: str
    updated_at: str


class AutomationExecutionItem(BaseModel):
    id: int
    rule_id: int
    rule_name: str
    rule_deleted: bool = False
    lead_id: str | None = None
    lead_name: str | None = None
    trigger_type: AutomationTrigger
    status: AutomationExecutionStatus
    scheduled_for: str
    paused_at: str | None = None
    # 'lead' si la congeló pausar el lead entero, 'execution' si el vendedor
    # pausó solo esta ejecución. None cuando no está congelada.
    pause_scope: ExecutionPauseScope | None = None
    started_at: str | None = None
    finished_at: str | None = None
    action_results: list[dict]
    flow_state: dict = Field(default_factory=dict)
    error: str | None = None
    # Causa del fallo cuando la UI la trata distinto; el texto va en `error`.
    error_code: ExecutionErrorCode | None = None
    created_at: str
    start_source: ExecutionStartSource = ExecutionStartSource.SYSTEM
    started_by_user_id: int | None = None
    started_by_name: str | None = None
    # Un admin autorizó a esta ejecución a enviar con la ventana de 24 h
    # cerrada. None cuando corre con la regla de siempre.
    window_override_at: str | None = None
    window_override_by_name: str | None = None


class AutomationExecutionRetryRequest(BaseModel):
    """Reintento de una ejecución con error. `ignore_service_window` es la
    autorización del admin para que los envíos salgan aunque la ventana de
    atención de 24 h esté cerrada; vale solo para esta ejecución."""

    ignore_service_window: bool = False


class AutomationFlowCreate(BaseModel):
    name: str
    flow_definition: dict


class AutomationFlowUpdate(BaseModel):
    name: str | None = None
    flow_definition: dict


class AutomationFlowSimulationRequest(BaseModel):
    lead_id: str


class ManualFlowStartRequest(BaseModel):
    chat_id: str


class AutomationFlowVersionItem(BaseModel):
    version: int
    created_at: str
    node_count: int
    edge_count: int
    is_current: bool

class AutomationFlowSimulation(BaseModel):
    lead_id: str
    lead_name: str | None = None
    flow_version: int
    # Un paso por bloque recorrido; cada tipo de bloque aporta sus datos.
    path: list[dict[str, Any]]
