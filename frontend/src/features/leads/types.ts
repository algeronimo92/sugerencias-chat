import type { ApiSchemas } from '../../shared/http/contract'
import type { JsonObject } from '../../shared/types'
import type { MessageType } from '../whatsapp/types'
import type { Tag } from '../catalogs/types'



export type LeadStage = string

/** Semántica de la etapa: `lost` pide la razón de pérdida al entrar. */
export type LeadStageKind = ApiSchemas['LeadStageItem']['kind']
export type LeadStageDefinition = ApiSchemas['LeadStageItem']
export type LeadStageAdminDefinition = ApiSchemas['LeadStageAdminItem']

export interface LeadStageInput {
  name: string
  color: string
  kind: LeadStageKind
  description?: string | null
}

export interface KanbanPage {
  items: Chat[]
  has_more: boolean
}

export interface KanbanSnapshot {
  counts: Record<LeadStage, number>
  stages: Record<LeadStage, KanbanPage>
}

export interface MoveLeadStageInput {
  chatId: string
  stage: LeadStage
  /** Solo se persiste al pasar a `perdido`; el backend la ignora si no. */
  razonPerdido?: string | null
}

export interface BulkActionResult {
  succeeded: string[]
  failed: string[]
}

export interface BulkMoveStageInput {
  chatIds: string[]
  stage: LeadStage
  razonPerdido?: string | null
}

export interface BulkAssignTagInput {
  chatIds: string[]
  tagId: number
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

export interface ChatsPage {
  items: Chat[]
  has_more: boolean
}

/** Cursor de keyset: última fila de la página anterior (mismo orden que la consulta del backend).
 * cursorRank indica en qué sección del orden con búsqueda quedó esa fila
 * (2 = matches por nombre, 1 = por campos CRM, 0 = por mensaje). */
export type PageParam = { cursorTs: string | null; cursorId: string; cursorRank?: number } | null
