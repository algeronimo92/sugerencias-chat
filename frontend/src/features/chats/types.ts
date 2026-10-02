import type { components } from '../../api/schema';
import type { JsonObject } from "../../shared/types";
import type { NotificationTypeValue } from '../automations/public/automationCatalog';
import type { LeadStage,Tag,TaskType } from '../leads/types';
import type { MetaInboundRootType,MetaOutboundRootType,MetaStatus as MetaStatusLiteral } from './domain/metaContract';

type ApiSchemas = components['schemas']

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


export interface ChatsPage {
  items: Chat[]
  has_more: boolean
}

export type PageParam = { cursorTs: string | null; cursorId: string; cursorRank?: number } | null

export interface MessagePage {
  items: Message[]
  has_more: boolean
}

export type MessageCursor = { cursorTs: string; cursorId: number } | null

export interface ReplyTarget {
  id: number
  sender: string
  content: string | null
}

export interface OptimisticMessageDraft {
  content: string | null
  media_url?: string | null
  reply_to?: ReplyTarget | null
  message_type?: MessageType | null
  message_subtype?: string | null
  payload?: JsonObject | null
  /** Cuerpo de Meta que se va a mandar, para pintar la burbuja igual que
   * cuando el backend la confirme. */
  provider_payload?: JsonObject | null
}

export interface OptimisticContext {
  optimisticIds: number[]
}

export interface TextPayload {
  text: string
  replyTo?: ReplyTarget | null
}

export interface AudioPayload {
  contentType: string
  dataBase64: string
  replyTo?: ReplyTarget | null
}

export interface MediaPayload {
  contentType: string
  dataBase64: string
  filename?: string
  /** Epígrafe opcional (el texto debajo de la imagen/video), como en WhatsApp. */
  caption?: string
  replyTo?: ReplyTarget | null
  /** Comparten este id las fotos/videos elegidos juntos en el mismo picker
   * (ver ChatComposer): agrupa el hilo en grilla sin depender de adivinar por
   * tiempo — la Cloud API de WhatsApp no tiene álbum saliente, así que esto
   * es puramente para la vista del propio CRM. */
  albumId?: string
}

export interface SendTemplatePayload {
  templateId: number
  text: string
  parameters?: string[]
  optimisticMessages: OptimisticMessageDraft[]
}

export interface ReactionPayload {
  messageId: number
  emoji: string
}

export interface ForwardPayload {
  messageIds: number[]
  targetChatIds: string[]
}

export interface ForwardResult {
  forwarded_chats: number
  forwarded_messages: number
  skipped_messages: number
}

export interface StickerPayload {
  assetId: number
  /** URL del asset, para pintar la burbuja optimista antes de la respuesta. */
  mediaUrl: string
}

export interface LocationPayload {
  latitude: number
  longitude: number
  replyTo?: ReplyTarget | null
}

export interface ContactShareInput {
  fullName: string
  phoneNumber: string
}

export interface ContactsPayload {
  contacts: ContactShareInput[]
  replyTo?: ReplyTarget | null
}

export interface InteractivePayload {
  interactive: JsonObject
  replyTo?: ReplyTarget | null
}

export interface TemplateInput {
  name: string
  content: string
  shortcut: string | null
  category: string
  stage: MessageTemplate['stage']
  task_type: MessageTemplate['task_type']
  service: string | null
  template_type: MessageTemplate['template_type']
  official_name: string | null
  official_language: string | null
  official_category: MessageTemplate['official_category']
  official_status?: MessageTemplate['official_status']
  official_parameter_values: string[]
  official_header_type: MessageTemplate['official_header_type']
  official_header_text: string | null
  official_header_media_asset_id: number | null
  official_footer: string | null
  official_buttons: MessageTemplate['official_buttons']
  interactive_type: MessageTemplate['interactive_type']
  interactive_config: MessageTemplate['interactive_config']
}

export interface NoteInput {
  content: string
  mentionedUserIds: number[]
}
