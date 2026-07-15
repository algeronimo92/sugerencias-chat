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
  sellerId: number | null
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
  vendedor_id: number | null
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

export type TaskType = 'whatsapp' | 'llamada' | 'cotizacion' | 'cita' | 'seguimiento' | 'otro'
export type TaskStatus = 'pending' | 'completed' | 'canceled'
export type TaskPriority = 'low' | 'normal' | 'high'

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
  is_favorite: boolean
  last_used_at: string | null
  use_count: number
  attachments: TemplateAttachment[]
}

export interface TemplateAttachment {
  id: number
  media_url: string
  content_type: string
  filename: string
  position: number
  library_asset_id: number | null
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
