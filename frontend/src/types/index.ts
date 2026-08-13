import type {
  AutomationActionTypeValue, AutomationBuilderModeValue, AutomationExecutionStatusValue,
  AutomationRecipientValue, AutomationTriggerValue, FlowConditionTypeValue,
  FlowHandleValue, FlowNodeTypeValue, NotificationTypeValue, QuestionHandleValue,
  TaskPriorityCatalogValue, TaskStatusCatalogValue, TaskTypeCatalogValue, WaitAnyConditionKindValue,
} from '../domain/automationCatalog'
import { AutomationActionType, FlowNodeType, WaitAnyConditionKind } from '../domain/automationCatalog'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject { [key: string]: JsonValue }

export const LEAD_STAGES = [
  // Flujo principal
  'nuevo',
  'en_diagnostico',
  'calificado',
  'oferta_presentada',
  'en_objecion',
  'agendado',
  'cliente_activo',
  'postventa',
  // Columnas secundarias
  'en_seguimiento',
  'en_nutricion',
  'perdido',
  'descalificado',
  'baja',
] as const

export type LeadStage = (typeof LEAD_STAGES)[number]

export function isLeadStage(value: string): value is LeadStage {
  return LEAD_STAGES.some(stage => stage === value)
}

export interface Tag {
  id: number
  name: string
  color: string
  is_active?: boolean
  created_by_user_id?: number | null
  created_by_name?: string | null
  created_at?: string | null
}

export interface LeadService {
  id: number
  name: string
  is_active?: boolean
  created_by_user_id?: number | null
  created_by_name?: string | null
  created_at?: string | null
}

export interface TemplateCategory {
  id: number
  name: string
  is_active?: boolean
  created_by_user_id?: number | null
  created_by_name?: string | null
  created_at?: string | null
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
  automationPaused: boolean
}

/** Filtros avanzados en cero: el estado inicial de la lista y el que usan las
 * vistas que listan leads sin ofrecer filtros (ej. el selector de reenvío). */
export const EMPTY_CHAT_FILTERS: ChatFilters = {
  unreadOnly: false,
  stages: [],
  tagIds: [],
  tagMode: 'any',
  service: '',
  sellerId: null,
  origin: '',
  lastSender: '',
  inactiveDays: null,
  waitingTime: '',
  automationPaused: false,
}

export interface LeadActivity {
  id: number
  event_type: string
  actor_type: string
  actor_name: string | null
  old_value: JsonObject | null
  new_value: JsonObject | null
  metadata: JsonObject | null
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
  metadata: JsonObject | null
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
  con_especialista: boolean
  /** Corta el piloto automático para este lead: los triggers de sistema
   * (mensaje entrante, cambio de etapa, etc.) dejan de programar
   * ejecuciones nuevas. El chat sigue abierto para conversar normal, y un
   * flujo iniciado a mano desde el chat lo ignora a propósito. */
  automatizacion_pausada: boolean
  /** Estado comercial propio del lead; no es la ventana de 24 h de WhatsApp. */
  conversacion_abierta: boolean
  conversacion_abierta_at: string | null
  conversacion_cerrada_at: string | null
  conversacion_version: number
  razon_perdido: string | null
  /** ISO date (YYYY-MM-DD), entra tal cual en un input type="date". */
  fecha_recontacto: string | null
  proxima_cita: string | null
  /** Contadores que lleva el sistema: solo lectura en el CRM. */
  contador_noshow: number | null
  toques_seguimiento: number | null
  fecha_ultimo_toque: string | null
  last_message: string | null
  last_message_sender: string | null
  /** Tipo del último mensaje: deja mostrar "📷 Imagen" en el preview de la
   * lista aunque `last_message` venga vacío (adjuntos sin caption). */
  last_message_type?: MessageType | null
  /** El último mensaje se eliminó: `last_message` viene vacío y el preview
   * muestra "Se eliminó este mensaje". */
  last_message_deleted?: boolean
  timestamp: string | null
  last_customer_message_at: string | null
  unread_count: number
  tags: Tag[]
  /** Solo con búsqueda activa: 2 = match por nombre/teléfono, 1 = por
   * campos CRM (vendedor/servicio/origen), 0 = solo por un mensaje. */
  search_rank?: number
  /** Mensaje que contiene el término buscado, para mostrar en el preview. */
  matched_message?: string | null
  /** Id de ese mensaje: al abrir el chat se salta hasta él y se resalta. */
  matched_message_id?: number | null
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
  con_especialista?: boolean
  automatizacion_pausada?: boolean
  conversacion_abierta?: boolean
  razon_perdido?: string | null
  fecha_recontacto?: string | null
  proxima_cita?: string | null
}

/** DISCARDED es un FAILED que alguien revisó y decidió no reenviar: sigue sin
 * haber llegado al cliente, pero ya no ofrece reintento ni cuenta como fallo
 * vivo en las métricas del backend. */
export type MessageStatus = 'PENDING' | 'FAILED' | 'DISCARDED' | 'SERVER_ACK' | 'DELIVERY_ACK' | 'READ' | 'PLAYED' | null

/** Taxonomía de tipos de mensaje, en concordancia con el backend
 * (models/schemas.py:MessageType) y con las estructuras de WhatsApp/Evolution
 * documentadas en docs/evolution-api-2.3-mensajes/. */
export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'ptv'
  | 'audio'
  | 'document'
  | 'location'
  | 'sticker'
  | 'contact'
  | 'poll'
  | 'reaction'
  | 'interactive'
  | 'template'
  | 'order'
  | 'product'
  | 'payment'
  | 'unsupported'

/** Enriquecimiento generado con IA para un adjunto: descripción de imagen/video,
 * transcripción de audio, OCR de documento. Se muestra bajo demanda, no dentro
 * de la burbuja. */
export interface MessageAnalysis {
  summary: string
  kind?: 'descripcion' | 'transcripcion' | 'ocr'
  model?: string
  generated_at?: string
  version?: number
}

export interface MessageReaction {
  emoji: string
  /** true = la puso el vendedor desde la app (o un dispositivo vinculado);
   * false = la puso el cliente. */
  from_me: boolean
}
export interface Message {
  id: number
  sender: string
  content: string | null
  sent_at: string | null
  media_url: string | null
  wa_message_id: string | null
  status: MessageStatus
  /** Tipo del mensaje. null solo en filas legadas sin backfillear: en ese caso
   * el frontend cae al parseo de pseudo-tags de `content`. */
  message_type?: MessageType | null
  /** Enriquecimiento IA del adjunto, servido aparte de `content`. */
  analysis?: MessageAnalysis | null
  /** Datos estructurados propios del tipo (lat/lon, filename, opciones…). */
  payload?: JsonObject | null
  /** Reacciones sobre este mensaje (badge estilo WhatsApp, no una burbuja
   * aparte): a lo sumo una por lado en un chat 1:1. null si nadie reaccionó. */
  reactions?: MessageReaction[] | null
  /** Última edición del texto. null = nunca se editó; con valor, la burbuja
   * muestra "Editado" al lado de la hora, como en WhatsApp. */
  edited_at?: string | null
  /** Eliminado para todos. Con valor, el backend ya no sirve el contenido ni
   * el adjunto y la burbuja se pinta como lápida. */
  deleted_at?: string | null
  /** Dimensiones de la imagen adjunta: permiten reservar el espacio exacto
   * antes de que cargue, para que la conversación no se mueva. */
  media_width?: number | null
  media_height?: number | null
  /** Mensaje citado, ya resuelto por el backend. Viene en null cuando el
   * mensaje no responde a nada o cuando el citado no está en nuestra base. */
  quoted_message_id?: number | null
  quoted_sender?: string | null
  quoted_content?: string | null
  /** Tipo del citado: deja mostrar "📷 Imagen" en la cita aunque su content
   * venga vacío (los adjuntos ya no llevan el tipo embebido en content). */
  quoted_message_type?: MessageType | null
}

/** Mensaje leído de WhatsApp que no está registrado en la base: es anterior
 * a que el sistema empezara a guardar el chat. Solo lectura — no tiene id
 * local, ni estado de entrega, y de los adjuntos solo llega el tipo y el
 * epígrafe (el archivo nunca se descarga). */
export interface HistoryMessage {
  wa_message_id: string
  sender: 'cliente' | 'vendedor'
  content: string | null
  sent_at: string
  message_type?: MessageType | null
  payload?: JsonObject | null
}

export interface HistoryPage {
  items: HistoryMessage[]
  has_more: boolean
  /** Cursor opaco de Evolution: se devuelve tal cual en el pedido siguiente. */
  next_page: number | null
}

export type ScheduledMessageStatus = 'scheduled' | 'processing' | 'queued' | 'sent' | 'failed' | 'cancelled'

export interface ScheduledMessage {
  id: number
  lead_id: string
  text: string
  scheduled_at: string
  status: ScheduledMessageStatus
  created_by_user_id: number
  created_by_user_name: string
  queued_message_id: number | null
  error: string | null
  created_at: string
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
  estado: LeadStage | null
  tipo_objecion: string | null
  senal_compra: boolean
  alerta: string | null
  confianza: string
  analisis: string
  sugerencias: Sugerencia[]
}

/** Estado de la sugerencia guardada de un lead — lectura barata que nunca
 * dispara la generación. `stale`: el cliente escribió después de generarse. */
export interface SuggestionStatus {
  suggestion: SuggestionResponse | null
  generated_at: string | null
  stale: boolean
}

export interface SettingItem {
  key: string
  label: string
  group: string
  group_label: string
  secret: boolean
  boolean: boolean
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

export interface PinStatus {
  available: boolean
  user_name?: string | null
  masked_email?: string | null
  device_name?: string | null
  locked_seconds: number
}

export interface AuthSession {
  id: string
  device_name: string
  auth_method: 'password' | 'pin'
  current: boolean
  created_at: string
  last_used_at: string
  absolute_expires_at: string
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
  created_by_user_id?: number | null
  created_by_name?: string | null
  created_at?: string | null
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

export type WaitAnyCondition =
  | WaitAnyTimerCondition
  | WaitAnyMessageCondition
  | WaitAnyBusinessHoursCondition
  | WaitAnyMediaPlayedCondition

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
  max_executions_per_hour: number | null
  is_active: boolean
  /** Solo aplica a flujos visuales con trigger_type='manual': si está en
   *  true, aparece en el selector "Iniciar flujo" del vendedor dentro del
   *  chat. El admin siempre puede dispararlo aunque esté en false. */
  visible_to_sellers: boolean
  created_by_user_id: number
  created_by_name: string
  execution_count: number
  last_execution_at: string | null
  last_execution_status: AutomationExecutionStatusValue | null
  created_at: string
  updated_at: string
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

export interface AutomationExecution {
  id: number
  rule_id: number
  rule_name: string
  rule_deleted: boolean
  lead_id: string | null
  lead_name: string | null
  trigger_type: AutomationTrigger
  status: AutomationExecutionStatusValue
  /** Cuándo le toca correr al paso pendiente. Mientras está `paused`, sigue
   *  siendo el vencimiento de antes de congelarse: lo que falta se mide
   *  contra `paused_at`, no contra ahora. */
  scheduled_for: string
  paused_at: string | null
  started_at: string | null
  finished_at: string | null
  action_results: AutomationActionResult[]
  flow_state: {
    current_node_id?: string | null
    path?: string[]
    flow_version?: number
    definition?: AutomationFlowDefinition
  }
  error: string | null
  created_at: string
  /** 'system' para los triggers automáticos de siempre, 'manual' cuando la
   *  inició un vendedor con el botón "Iniciar flujo" del chat. */
  start_source: AutomationExecutionStartSource
  started_by_user_id: number | null
  started_by_name: string | null
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
