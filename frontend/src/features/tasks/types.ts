import type { TaskPriorityCatalogValue, TaskStatusCatalogValue, TaskTypeCatalogValue } from '../automations/public/automationCatalog'


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
