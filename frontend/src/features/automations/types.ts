import type { ApiSchemas, Delivered } from '../../shared/http/contract'
import type { LeadStage, TaskPriority, TaskType } from '../leads/types';
import type { AutomationActionTypeValue, AutomationExecutionStatusValue, AutomationRecipientValue, AutomationTriggerValue, FlowConditionTypeValue, FlowHandleValue, FlowNodeTypeValue, QuestionHandleValue, WaitAnyConditionKindValue } from "./domain/automationCatalog";
import { AutomationActionType, FlowNodeType, WaitAnyConditionKind } from './domain/automationCatalog';

export type AutomationTrigger = AutomationTriggerValue
export type AutomationActionType = AutomationActionTypeValue

export interface AutomationConditions {
  stage?: LeadStage | null
  origin_contains?: string | null
  service_contains?: string | null
  seller_id?: number | null
  tag_id?: number | null
  require_open_window?: boolean
  business_hours_only?: boolean
  cooldown_minutes?: number | null
}

export interface CreateTaskAutomationAction {
  type: typeof AutomationActionType.CreateTask
  title: string
  description: string | null
  task_type: TaskType
  priority: TaskPriority
  due_minutes: number
  remind_minutes_before: number
  assigned_user_id: number | null
}

export interface AssignSellerAutomationAction {
  type: typeof AutomationActionType.AssignSeller
  user_id: number | null
}

export interface TagAutomationAction {
  type: typeof AutomationActionType.AddTag | typeof AutomationActionType.RemoveTag
  tag_id: number | null
}

export interface ChangeStageAutomationAction {
  type: typeof AutomationActionType.ChangeStage
  stage: LeadStage
}

export interface NotifyAutomationAction {
  type: typeof AutomationActionType.Notify
  recipient: AutomationRecipientValue
  user_id: number | null
  title: string
  body: string
}

export interface SendTemplateAutomationAction {
  type: typeof AutomationActionType.SendTemplate
  template_id: number | null
}

export interface SendMessageAutomationAction {
  type: typeof AutomationActionType.SendMessage
  text: string
}

export interface ChangeServiceAutomationAction {
  type: typeof AutomationActionType.ChangeService
  service: string | null
}

export interface SetConversationStateAutomationAction {
  type: typeof AutomationActionType.SetConversationState
  state: 'open' | 'closed'
}

export interface SendAudioAutomationAction {
  type: typeof AutomationActionType.SendAudio
  media_asset_id: number | null
}

export interface SendAttachmentAutomationAction {
  type: typeof AutomationActionType.SendAttachment
  media_asset_id: number | null
}

export interface SendMediaAutomationAction {
  type: typeof AutomationActionType.SendMedia
  media_asset_id: number | null
  caption: string
}

export interface ReactToLastCustomerMessageAutomationAction {
  type: typeof AutomationActionType.ReactToLastCustomerMessage
  emoji: string
}

export type AutomationAction =
  | CreateTaskAutomationAction
  | AssignSellerAutomationAction
  | TagAutomationAction
  | ChangeStageAutomationAction
  | NotifyAutomationAction
  | SendTemplateAutomationAction
  | SendMessageAutomationAction
  | ChangeServiceAutomationAction
  | SetConversationStateAutomationAction
  | SendAudioAutomationAction
  | SendAttachmentAutomationAction
  | SendMediaAutomationAction
  | ReactToLastCustomerMessageAutomationAction

export type AutomationFlowNodeType = FlowNodeTypeValue
export type AutomationFlowConditionType = FlowConditionTypeValue

export interface WaitAnyTimerCondition {
  id: typeof WaitAnyConditionKind.Timer
  kind: typeof WaitAnyConditionKind.Timer
  seconds: number
}

export interface WaitAnyMessageCondition {
  id: typeof WaitAnyConditionKind.Message
  kind: typeof WaitAnyConditionKind.Message
}

export interface WaitAnyBusinessHoursCondition {
  id: typeof WaitAnyConditionKind.BusinessHours
  kind: typeof WaitAnyConditionKind.BusinessHours
}

export interface WaitAnyMediaPlayedCondition {
  id: typeof WaitAnyConditionKind.MediaPlayed
  kind: typeof WaitAnyConditionKind.MediaPlayed
}

/** El cliente nos mandó una foto o un archivo. Va aparte de
 *  WaitAnyMessageCondition: si el bloque declara las dos, el texto sale por
 *  "mensaje" y el adjunto por acá. */
export interface WaitAnyMediaReceivedCondition {
  id: typeof WaitAnyConditionKind.MediaReceived
  kind: typeof WaitAnyConditionKind.MediaReceived
}

export type WaitAnyCondition =
  | WaitAnyTimerCondition
  | WaitAnyMessageCondition
  | WaitAnyBusinessHoursCondition
  | WaitAnyMediaPlayedCondition
  | WaitAnyMediaReceivedCondition

export interface QuestionButton {
  id: string
  label: string
}

/** Salida de un bloque Round robin. El id es posicional (`out_1..out_n`) y es
 *  el handle con el que el lienzo dibuja su conexión. */
export interface RoundRobinOutput {
  id: string
  label: string
}

export interface AutomationFlowConditionItem {
  id: string
  condition_type: AutomationFlowConditionType
  value: string | number | boolean | null
}

export interface AutomationFlowConditionGroup {
  id: string
  conditions: AutomationFlowConditionItem[]
}

interface BaseAutomationFlowNode<TType extends AutomationFlowNodeType, TData> {
  id: string
  type: TType
  position: { x: number; y: number }
  data: TData
}

export type AutomationFlowNode =
  | BaseAutomationFlowNode<typeof FlowNodeType.Trigger, { trigger_type: AutomationTrigger; minutes?: number }>
  | BaseAutomationFlowNode<typeof FlowNodeType.Condition, {
      condition_groups?: AutomationFlowConditionGroup[]
      /** Compatibilidad con definiciones publicadas antes de los grupos. */
      condition_type?: AutomationFlowConditionType
      value?: string | number | boolean | null
    }>
  | BaseAutomationFlowNode<typeof FlowNodeType.Action, { action: AutomationAction }>
  | BaseAutomationFlowNode<typeof FlowNodeType.InvokeFlow, { flow_rule_id: number | null }>
  | BaseAutomationFlowNode<typeof FlowNodeType.Wait, { seconds: number }>
  | BaseAutomationFlowNode<typeof FlowNodeType.WaitAny, { conditions: WaitAnyCondition[] }>
  | BaseAutomationFlowNode<typeof FlowNodeType.Question, { text: string; buttons: QuestionButton[]; timeout_seconds: number }>
  | BaseAutomationFlowNode<typeof FlowNodeType.RoundRobin, { outputs: RoundRobinOutput[] }>
  | BaseAutomationFlowNode<typeof FlowNodeType.End, { label: string; close_conversation?: boolean }>

export interface AutomationFlowEdge {
  id: string
  source: string
  target: string
  // Condición, Pausa, Pregunta y Round robin agregan handles dinámicos (ids
  // de grupos OR, condiciones de espera, botones y salidas del reparto) fuera
  // del enum fijo FlowHandle.
  source_handle: FlowHandleValue | WaitAnyConditionKindValue | QuestionHandleValue | string
}

export interface AutomationFlowDefinition {
  conditions: AutomationConditions
  nodes: AutomationFlowNode[]
  edges: AutomationFlowEdge[]
}

/** Una regla tal como la entrega el backend (contrato `AutomationRuleItem`). */
export type ContractAutomationRule = Delivered<ApiSchemas['AutomationRuleItem']>

/**
 * Una regla de automatización. Sale del contrato con lo que el contrato deja
 * abierto refinado en la frontera (`toAutomationRule`): la configuración, las
 * condiciones, las acciones y el flujo son JSON que valida el dominio del
 * backend.
 *
 * `visible_to_sellers` solo aplica a flujos visuales con trigger manual: si es
 * true aparece en "Iniciar flujo" del chat (el admin siempre puede).
 */
export type AutomationRule = Omit<
  ContractAutomationRule,
  'trigger_config' | 'conditions' | 'actions' | 'flow_definition' | 'published_flow_definition'
> & {
  trigger_config: { minutes?: number }
  conditions: AutomationConditions
  actions: AutomationAction[]
  flow_definition: AutomationFlowDefinition | Record<string, never>
  published_flow_definition: AutomationFlowDefinition | null
}

export type AutomationExecutionStartSource = 'system' | 'manual' | 'flow'

export interface AutomationActionResult {
  position?: number
  /** En una regla simple es el tipo de acción; en un flujo visual, el tipo de
   *  nodo (`wait`, `wait_any`, `question`, `condition`, `end`…). */
  type?: AutomationActionType | FlowNodeTypeValue
  status?: string
  error?: string
  flow_rule_id?: number
  child_execution_id?: number
  /** Solo en flujos visuales. */
  node_id?: string | null
  /** Segundos de espera de un bloque Pausa clásico (`wait`). */
  seconds?: number
  /** Salida por la que resolvió un bloque Pausa/Pregunta. */
  branch?: string
  conditions?: WaitAnyCondition[]
  message_ids?: number[]
}

/** Una ejecución tal como la entrega el backend (contrato `AutomationExecutionItem`). */
export type ContractAutomationExecution = Delivered<ApiSchemas['AutomationExecutionItem']>

/**
 * Una ejecución de una regla. Sale del contrato con lo que el contrato deja
 * abierto refinado en la frontera (`toAutomationExecution`):
 *
 * - `scheduled_for`: cuándo le toca el paso pendiente. Mientras está `paused`
 *   sigue siendo el vencimiento de antes de congelarse.
 * - `pause_scope`: 'lead' si se pausó el chat entero (botón del bot en la
 *   cabecera), 'execution' si se pausó solo esta. Una de alcance 'lead' la
 *   reanuda el chat.
 * - `start_source`: 'system' para los triggers automáticos, 'manual' para
 *   "Iniciar flujo" del chat, 'flow' para un flujo invocado por otro.
 * - `window_override_at`: un admin autorizó enviar con la ventana de 24 h
 *   cerrada.
 * - `action_results` y `flow_state` son JSON que escribe el motor.
 */
export type AutomationExecution = Omit<ContractAutomationExecution, 'action_results' | 'flow_state'> & {
  action_results: AutomationActionResult[]
  flow_state: {
    current_node_id?: string | null
    path?: string[]
    flow_version?: number
    definition?: AutomationFlowDefinition
  }
}

export interface AutomationRuleInput {
  name: string
  trigger_type: AutomationTrigger
  trigger_config: { minutes?: number }
  conditions: AutomationConditions
  actions: AutomationAction[]
  delay_minutes: number
  max_executions_per_hour: number | null
  is_active: boolean
  visible_to_sellers: boolean
}

export interface AutomationExecutionFilters {
  ruleId?: number
  /** Acota el historial a un chat puntual: dentro de un chat el vendedor ve
   *  todo lo que corre sobre ese lead (también triggers de sistema) — es lo
   *  que usa el pill "Flujo en curso" dentro del chat. */
  chatId?: string
  status?: AutomationExecutionStatusValue
  excludeSkipped?: boolean
  /** true = solo ejecuciones no terminales (scheduled/running/paused), false
   *  = solo terminales (completed/failed/skipped). Se ignora en el backend
   *  si `status` también viene informado. */
  active?: boolean
  /** Rango de fechas en 'YYYY-MM-DD', filtrando por `created_at` en la
   *  timezone de negocio (America/Lima). Ambos deben venir juntos. */
  dateFrom?: string
  dateTo?: string
  /** Acota a las ejecuciones que el propio usuario disparó a mano, sin
   *  importar el rol. Sin chatId, un vendedor siempre queda acotado así en el
   *  backend aunque no se mande explícito; se usa para que la pantalla
   *  "Flujos enviados" se comporte igual si la abre un admin. */
  mine?: boolean
}

export interface AutomationFlowVersion {
  version: number
  created_at: string
  node_count: number
  edge_count: number
  is_current: boolean
}

/** Lo que entrega el backend al simular un flujo (contrato
 * `AutomationFlowSimulation`). */
export type ContractFlowSimulation = Delivered<ApiSchemas['AutomationFlowSimulation']>

/** Una simulación. Cada paso lo arma el bloque que se recorrió: el contrato lo
 * declara como JSON y la frontera le da su forma (`toFlowSimulation`). */
export type AutomationFlowSimulation = Omit<ContractFlowSimulation, 'path'> & {
  path: AutomationFlowSimulationStep[]
}

export interface AutomationFlowSimulationStep {
  node_id?: string | null
  type: AutomationFlowNodeType | AutomationActionType | 'entry_conditions'
  status: AutomationExecutionStatusValue | 'matched' | 'evaluated' | 'would_run' | 'would_fail' | 'would_wait'
  branch?: string
  minutes?: number
  seconds?: number
  detail?: string
}
