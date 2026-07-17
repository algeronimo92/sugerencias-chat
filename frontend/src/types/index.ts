import type {
  AutomationActionTypeValue, AutomationBuilderModeValue, AutomationExecutionStatusValue,
  AutomationRecipientValue, AutomationTriggerValue, FlowConditionTypeValue,
  FlowHandleValue, FlowNodeTypeValue, NotificationTypeValue, TaskPriorityCatalogValue,
  TaskStatusCatalogValue, TaskTypeCatalogValue,
} from '../domain/automationCatalog'
import { AutomationActionType, FlowNodeType } from '../domain/automationCatalog'

export const LEAD_STAGES = [
  'nuevo',
  'calificacion',
  'cotizacion',
  'objecion',
  'cierre',
  'agendado',
  'postventa',
  'sin_respuesta',
  'reactivacion',
  'perdido',
] as const

export type LeadStage = (typeof LEAD_STAGES)[number]

export function isLeadStage(value: string): value is LeadStage {
  return LEAD_STAGES.some(stage => stage === value)
}

export interface Tag {
  id: number
  name: string
  color: string
}

export interface ChatFilters {
  unreadOnly: boolean
  stages: LeadStage[]
  tagIds: number[]
  tagMode: 'any' | 'all'
  service: string
  sellerId: number | null
  origin: string
  lastSender: '' | 'cliente' | 'vendedor'
  inactiveDays: number | null
  waitingTime: '' | 'any' | 'fresh' | 'warning' | 'urgent'
}

export interface LeadActivity {
  id: number
  event_type: string
  actor_type: string
  actor_name: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface InternalNoteMention {
  user_id: number
  user_name: string
}

export interface InternalNote {
  id: number
  lead_id: string
  author_user_id: number
  author_name: string
  content: string
  created_at: string
  updated_at: string
  is_edited: boolean
  mentions: InternalNoteMention[]
}

export interface UserNotification {
  id: number
  notification_type: NotificationTypeValue
  title: string
  body: string
  lead_id: string | null
  source_id: string | null
  metadata: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

export interface NotificationPage {
  items: UserNotification[]
  unread_count: number
  has_more: boolean
}

export interface Chat {
  chat_id: string
  phone: string | null
  name: string | null
  servicio_interes: string | null
  vendedor_id: number | null
  vendedor: string | null
  origen: string | null
  notas: string | null
  stage: LeadStage
  last_message: string | null
  last_message_sender: string | null
  timestamp: string | null
  last_customer_message_at: string | null
  unread_count: number
  tags: Tag[]
}

export interface LeadInput {
  phone: string
  name: string
  servicio_interes?: string | null
  vendedor_id?: number | null
  origen?: string | null
  notas?: string | null
}

export interface LeadUpdateInput {
  phone?: string | null
  name?: string | null
  servicio_interes?: string | null
  vendedor_id?: number | null
  origen?: string | null
  notas?: string | null
}

export type MessageStatus = 'SERVER_ACK' | 'DELIVERY_ACK' | 'READ' | 'PLAYED' | null

export interface Message {
  id: number
  sender: string
  content: string | null
  sent_at: string | null
  media_url: string | null
  wa_message_id: string | null
  status: MessageStatus
}

export interface CustomerServiceWindow {
  is_open: boolean
  last_customer_message_at: string | null
  expires_at: string | null
  seconds_remaining: number
}

export interface Sugerencia {
  tactica: string
  canal: string
  texto?: string
  adjuntos: string[]
  motivo_adjuntos: string
  porque: string
}

export interface SuggestionResponse {
  estado: LeadStage
  tipo_objecion: string | null
  confianza: string
  analisis: string
  sugerencias: Sugerencia[]
}

export interface SettingItem {
  key: string
  label: string
  group: string
  group_label: string
  secret: boolean
  configured: boolean
  value: string | null
}

export type UserRole = 'admin' | 'vendedor'

export interface AuthUser {
  id: number
  email: string
  name: string
  role: UserRole
}

export interface AppUser {
  id: number
  email: string
  name: string
  role: UserRole
  is_active: boolean
}

export interface SellerOption {
  id: number
  name: string
  role: UserRole
}

export type TaskType = TaskTypeCatalogValue
export type TaskStatus = TaskStatusCatalogValue
export type TaskPriority = TaskPriorityCatalogValue

export interface LeadTask {
  id: number
  lead_id: string
  lead_name: string | null
  title: string
  description: string | null
  task_type: TaskType
  status: TaskStatus
  priority: TaskPriority
  due_at: string
  remind_at: string | null
  assigned_user_id: number
  assigned_user_name: string
  is_overdue: boolean
  created_at: string
}

export interface MessageTemplate {
  id: number
  name: string
  content: string
  shortcut: string | null
  category: string
  stage: LeadStage | null
  task_type: TaskType | null
  service: string | null
  is_active: boolean
  visibility: 'global' | 'personal'
  template_type: 'internal' | 'official'
  official_name: string | null
  official_language: string | null
  official_category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | null
  official_status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED' | null
  official_parameter_values: string[]
  interactive_type: 'none' | 'buttons' | 'list'
  interactive_config: TemplateInteractiveConfig
  is_favorite: boolean
  last_used_at: string | null
  use_count: number
  attachments: TemplateAttachment[]
}

export interface TemplateInteractiveButton {
  type: 'reply' | 'url' | 'call' | 'copy'
  displayText: string
  id?: string
  url?: string
  phoneNumber?: string
  copyCode?: string
}

export interface TemplateInteractiveRow {
  title: string
  description: string
  rowId: string
}

export interface TemplateInteractiveSection {
  title: string
  rows: TemplateInteractiveRow[]
}

export interface TemplateInteractiveConfig {
  title?: string
  footer?: string
  buttons?: TemplateInteractiveButton[]
  footerText?: string
  buttonText?: string
  sections?: TemplateInteractiveSection[]
}

export interface TemplateCapabilities {
  integration: string | null
  official_sending_supported: boolean
  reason: string | null
}

export interface TemplateAttachment {
  id: number
  media_url: string
  content_type: string
  filename: string
  position: number
  library_asset_id: number | null
}

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

export type AutomationAction =
  | CreateTaskAutomationAction
  | AssignSellerAutomationAction
  | TagAutomationAction
  | ChangeStageAutomationAction
  | NotifyAutomationAction
  | SendTemplateAutomationAction

export type AutomationFlowNodeType = FlowNodeTypeValue
export type AutomationFlowConditionType = FlowConditionTypeValue

interface BaseAutomationFlowNode<TType extends AutomationFlowNodeType, TData> {
  id: string
  type: TType
  position: { x: number; y: number }
  data: TData
}

export type AutomationFlowNode =
  | BaseAutomationFlowNode<typeof FlowNodeType.Trigger, { trigger_type: AutomationTrigger; minutes?: number }>
  | BaseAutomationFlowNode<typeof FlowNodeType.Condition, { condition_type: AutomationFlowConditionType; value: string | number | boolean | null }>
  | BaseAutomationFlowNode<typeof FlowNodeType.Action, { action: AutomationAction }>
  | BaseAutomationFlowNode<typeof FlowNodeType.Wait, { minutes: number }>
  | BaseAutomationFlowNode<typeof FlowNodeType.End, { label: string }>

export interface AutomationFlowEdge {
  id: string
  source: string
  target: string
  source_handle: FlowHandleValue
}

export interface AutomationFlowDefinition {
  conditions: AutomationConditions
  nodes: AutomationFlowNode[]
  edges: AutomationFlowEdge[]
}

export interface AutomationRule {
  id: number
  name: string
  trigger_type: AutomationTrigger
  trigger_config: { minutes?: number }
  conditions: AutomationConditions
  actions: AutomationAction[]
  builder_mode: AutomationBuilderModeValue
  flow_definition: AutomationFlowDefinition | Record<string, never>
  published_flow_definition: AutomationFlowDefinition | null
  flow_version: number
  delay_minutes: number
  is_active: boolean
  created_by_user_id: number
  created_by_name: string
  execution_count: number
  last_execution_at: string | null
  last_execution_status: AutomationExecutionStatusValue | null
  created_at: string
  updated_at: string
}

export interface AutomationExecution {
  id: number
  rule_id: number
  rule_name: string
  lead_id: string | null
  lead_name: string | null
  trigger_type: AutomationTrigger
  status: AutomationExecutionStatusValue
  scheduled_for: string
  started_at: string | null
  finished_at: string | null
  action_results: Array<Record<string, unknown>>
  flow_state: {
    current_node_id?: string | null
    path?: string[]
    flow_version?: number
    definition?: AutomationFlowDefinition
  }
  error: string | null
  created_at: string
}

export type MediaAssetKind = 'image' | 'video' | 'audio' | 'document'

export interface MediaAsset {
  id: number
  media_url: string
  content_type: string
  filename: string
  size_bytes: number
  uploaded_by_user_id: number | null
  uploaded_by_name: string | null
  created_at: string
  use_count: number
}

export interface DashboardMetricItem {
  name: string
  value: number
}

export interface DashboardPoint {
  date: string
  value: number
}

export interface DashboardMetrics {
  period_days: number
  summary: {
    total_leads: number
    new_leads: number
    awaiting_reply: number
    overdue_tasks: number
    completed_tasks: number
    avg_response_minutes: number | null
  }
  stages: DashboardMetricItem[]
  origins: DashboardMetricItem[]
  services: DashboardMetricItem[]
  sellers: DashboardMetricItem[]
  new_leads_trend: DashboardPoint[]
  generated_at: string
}
