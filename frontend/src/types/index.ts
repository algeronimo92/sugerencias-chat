import type {
  MetaInboundRootType,
  MetaOutboundRootType,
  MetaStatus as MetaStatusLiteral,
} from '../domain/metaContract'
import type {
  AutomationActionTypeValue, AutomationBuilderModeValue, AutomationExecutionStatusValue,
  AutomationRecipientValue, AutomationTriggerValue, FlowConditionTypeValue,
  FlowHandleValue, FlowNodeTypeValue, NotificationTypeValue, QuestionHandleValue,
  TaskPriorityCatalogValue, TaskStatusCatalogValue, TaskTypeCatalogValue, WaitAnyConditionKindValue,
} from '../domain/automationCatalog'
import { AutomationActionType, FlowNodeType, WaitAnyConditionKind } from '../domain/automationCatalog'
import type { components } from '../api/schema'

type ApiSchemas = components['schemas']

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject { [key: string]: JsonValue }

/** Clave estable de una etapa del embudo (`lead_stages.key`). Cada negocio
 * define las suyas, así que ya no es una unión cerrada: la lista, el orden,
 * los nombres y los colores vienen de `useLeadStages` (ver
 * domain/leadStageMeta.ts para el respaldo mientras cargan). */
export type LeadStage = string

/** Semántica de la etapa: `lost` pide la razón de pérdida al entrar. */
export type LeadStageKind = ApiSchemas['LeadStageItem']['kind']
export type LeadStageDefinition = ApiSchemas['LeadStageItem']
export type LeadStageAdminDefinition = ApiSchemas['LeadStageAdminItem']

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
  /** Catálogo que consulta el asistente IA; la moneda es la del perfil del negocio. */
  description?: string | null
  /** Decimal serializado como texto ("150.00"). */
  price?: string | null
  price_notes?: string | null
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

export type IssueReportStatus = 'new' | 'in_review' | 'needs_info' | 'resolved'
export type IssueReportPriority = 'low' | 'normal' | 'high' | 'critical'

export interface IssueReportAttachment {
  id: number
  media_url: string
  filename: string
  content_type: string
  size_bytes: number
}

export interface IssueReport {
  id: number
  public_code: string
  reporter_user_id: number
  reporter_name: string
  title: string
  description: string
  status: IssueReportStatus
  priority: IssueReportPriority
  current_path: string
  lead_id: string | null
  technical_context: JsonObject
  attachments: IssueReportAttachment[]
  comment_count: number
  resolved_at: string | null
  resolved_by_name: string | null
  created_at: string
  updated_at: string
}

export interface IssueReportComment {
  id: number
  author_user_id: number
  author_name: string
  author_role: UserRole
  content: string
  created_at: string
}

export interface IssueReportEvent {
  id: number
  actor_name: string | null
  event_type: 'created' | 'status_changed' | 'priority_changed'
  previous_value: string | null
  new_value: string | null
  created_at: string
}

export interface IssueReportDetail extends IssueReport {
  comments: IssueReportComment[]
  events: IssueReportEvent[]
}

export interface Chat {
  chat_id: string
  phone: string | null
  /** Número informativo (llamadas, contacto alternativo), distinto del que
   * WhatsApp usa para mandar mensajes. Texto libre, sin verificación. */
  secondary_phone: string | null
  /** Username público informado por Meta. Puede ser nulo. */
  username: string | null
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
  /** Tipo y subtipo literales de Meta del último mensaje: la lista lo resume
   * con el mismo contrato que la burbuja, aunque `last_message` venga vacío. */
  last_message_type?: MessageType | null
  last_message_subtype?: string | null
  /** El último mensaje se eliminó: `last_message` viene vacío y el preview
   * muestra "Se eliminó este mensaje". */
  last_message_deleted?: boolean
  timestamp: string | null
  last_customer_message_at: string | null
  unread_count: number
  /** Última vez que un vendedor vio la conversación (abrió el chat en la
   * app, o WhatsApp mandó un recibo de lectura nativo). */
  last_read_at: string | null
  /** Última respuesta de un bot/automatización (sin vendedor detrás). Si es
   * más nueva que last_read_at, el chat está "atendido" aunque nadie del
   * equipo lo haya visto todavía — ver isBotAttended en utils/chat. */
  last_automated_reply_at: string | null
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
  secondary_phone?: string | null
  custom_fields?: Record<string, unknown>
}

export interface LeadUpdateInput {
  phone?: string | null
  secondary_phone?: string | null
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
  custom_fields?: Record<string, unknown>
}

/** Estado interno de un envío en la cola propia (outbox). `discarded` es un
 * fallo que alguien revisó y decidió no reenviar: sigue sin haber llegado al
 * cliente, pero ya no ofrece reintento. */
export type OutboxStatus = 'queued' | 'sending' | 'sent' | 'retryable_failed' | 'failed' | 'discarded'

/** Estado literal que informa Meta. Un valor nuevo llega con su nombre. */
export type MetaStatus = MetaStatusLiteral | (string & {})

/** `messages[].type` literal de Meta (ver backend/contracts/meta_messages.json).
 * Un tipo que el contrato todavía no conoce llega igual, con su nombre, y se
 * muestra con un renderer genérico en vez de perderse. */
export type MessageType = MetaInboundRootType | MetaOutboundRootType | (string & {})

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
  /** Generado por el backend desde `sender`: `inbound` o `outbound`. */
  direction?: 'inbound' | 'outbound' | null
  content: string | null
  sent_at: string | null
  media_url: string | null
  wa_message_id: string | null
  /** Estado de la cola propia (solo salientes enviados desde el CRM). */
  outbox_status?: OutboxStatus | null
  /** Estado literal que informó Meta, y el evento completo con sus errores. */
  meta_status?: MetaStatus | null
  status_payload?: JsonObject | null
  message_type?: MessageType | null
  /** Subtipo literal (`interactive.type`, `system.type`). */
  message_subtype?: string | null
  /** El objeto de Meta del mensaje, o el cuerpo exacto que se le envió. */
  provider_payload?: JsonObject | null
  /** Enriquecimiento IA del adjunto, servido aparte de `content`. */
  analysis?: MessageAnalysis | null
  /** Proyección del CRM: lo que el cuerpo de Meta no trae (datos de plantilla,
   * reenviado, álbum, imagen del anuncio). */
  payload?: JsonObject | null
  /** Reacciones sobre este mensaje (badge estilo WhatsApp, no una burbuja
   * aparte): a lo sumo una por lado en un chat 1:1. null si nadie reaccionó. */
  reactions?: MessageReaction[] | null
  edited_at?: string | null
  /** Eliminado para todos (histórico). Con valor, el backend ya no sirve el
   * contenido ni el adjunto y la burbuja se pinta como lápida. */
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
  quoted_message_type?: MessageType | null
  /** Fijado nativo del CRM (no existe forma de fijar un mensaje del lado de
   * quien envía en WhatsApp, así que esto no se refleja allá). */
  pinned_at?: string | null
  /** Motivo real de un envío que el outbox dio por fallido. */
  error_detail?: string | null
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
  official_status: string | null
  official_rejected_reason: string | null
  official_parameter_values: string[]
  meta_template_id: string | null
  official_header_type: 'none' | 'text' | 'image'
  official_header_text: string | null
  official_header_media_asset_id: number | null
  official_header_media_url: string | null
  official_header_media_content_type: string | null
  official_header_media_filename: string | null
  official_footer: string | null
  official_buttons: OfficialTemplateButton[]
  interactive_type: TemplateInteractiveType
  interactive_config: TemplateInteractiveConfig
  imported_from_meta: boolean
  is_favorite: boolean
  last_used_at: string | null
  use_count: number
  created_by_user_id?: number | null
  created_by_name?: string | null
  created_at?: string | null
  attachments: TemplateAttachment[]
}

export interface OfficialTemplateButton {
  type: 'quick_reply' | 'url' | 'phone_number'
  text: string
  url?: string
  phone_number?: string
}

/** Plantilla tal cual la devuelve la Graph API (`GET /{waba_id}/message_templates`),
 * antes de vincularla a la app -- ver `useMetaTemplates`. */
export interface MetaTemplateRaw {
  id: string
  name: string
  status: string
  category: string
  language: string
  rejected_reason?: string | null
  components?: {
    type: string
    format?: string
    text?: string
    buttons?: { type: string; text: string; url?: string; phone_number?: string }[]
  }[]
}

/** Subtipo interactivo de una plantilla del CRM: el literal de Meta. */
export type TemplateInteractiveType = 'none' | 'button' | 'list'

export interface InteractiveReplyButton {
  type: 'reply'
  reply: { id: string; title: string }
}

export interface InteractiveListRow {
  id: string
  title: string
  description?: string
}

export interface InteractiveListSection {
  title?: string
  rows: InteractiveListRow[]
}

/** Objeto `interactive` de Meta sin `type` ni `body`: así se guarda en la
 * plantilla (el cuerpo sale del texto y el subtipo de `interactive_type`). */
export interface TemplateInteractiveConfig {
  header?: { type: 'text'; text: string }
  footer?: { text: string }
  action?: {
    buttons?: InteractiveReplyButton[]
    button?: string
    sections?: InteractiveListSection[]
  }
}

export type TemplateCapabilities = ApiSchemas['TemplateCapabilities']

export type InteractiveLimits = ApiSchemas['InteractiveLimits']

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
  /** Quién la congeló: 'lead' si fue pausar el chat entero (botón del bot en la
   *  cabecera), 'execution' si el vendedor pausó solo esta desde el panel.
   *  Una de alcance 'lead' no se puede reanudar sola: la reanuda el chat. */
  pause_scope: 'lead' | 'execution' | null
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
  /** Un admin autorizó a esta ejecución a enviar con la ventana de 24 h
   *  cerrada. null cuando corre con la regla de siempre. */
  window_override_at: string | null
  window_override_by_name: string | null
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
  /** Con descripción, el asistente IA puede proponerlo como adjunto. */
  ai_description?: string | null
}

/** Perfil del negocio que el asistente IA recibe en cada sugerencia. */
export interface AIProfile {
  business_name: string | null
  business_description: string | null
  location: string | null
  opening_hours: string | null
  currency: string | null
  tone: string | null
  always_rules: string | null
  never_rules: string | null
  updated_at?: string | null
}

export interface KnowledgeDocumentSummary {
  id: string
  title: string
  document_type: string | null
  characters: number
  chunk_count: number
  created_at: string
  updated_at: string
}

export interface KnowledgeDocument extends KnowledgeDocumentSummary {
  content: string
}

/** Habilitación y cuota del asistente: las decide la plataforma, no el negocio. */
export interface AIUsage {
  enabled: boolean
  monthly_quota: number | null
  used_this_month: number
  remaining: number | null
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
