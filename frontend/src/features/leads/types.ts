import type { components } from '../../api/schema';
import type { TaskPriorityCatalogValue,TaskStatusCatalogValue,TaskTypeCatalogValue } from '../automations/public/automationCatalog';
import type { Chat } from "../chats/types";

type ApiSchemas = components['schemas']

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

export interface LeadStageInput {
  name: string
  color: string
  kind: LeadStageKind
  description?: string | null
}

export type CustomFieldEntity = 'lead' | 'appointment'

export type CustomFieldType = 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'boolean' | 'select'

export interface CustomFieldDefinition {
  id: number
  entity_type: CustomFieldEntity
  key: string
  label: string
  field_type: CustomFieldType
  required: boolean
  options: string[]
  position: number
  is_active: boolean
}

export interface TaskInput {
  lead_id: string
  title: string
  description?: string | null
  task_type: TaskType
  priority: TaskPriority
  due_at: string
  remind_at?: string | null
  assigned_user_id?: number
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
