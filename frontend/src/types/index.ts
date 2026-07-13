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
  seller: string
  origin: string
  lastSender: '' | 'cliente' | 'vendedor'
  inactiveDays: number | null
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

export interface Chat {
  chat_id: string
  phone: string | null
  name: string | null
  servicio_interes: string | null
  vendedor: string | null
  origen: string | null
  notas: string | null
  stage: LeadStage
  last_message: string | null
  last_message_sender: string | null
  timestamp: string | null
  unread_count: number
  tags: Tag[]
}

export interface LeadInput {
  phone: string
  name: string
  servicio_interes?: string | null
  vendedor?: string | null
  origen?: string | null
  notas?: string | null
}

export interface LeadUpdateInput {
  phone?: string | null
  name?: string | null
  servicio_interes?: string | null
  vendedor?: string | null
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
