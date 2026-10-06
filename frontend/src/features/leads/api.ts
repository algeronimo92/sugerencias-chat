import type { BulkActionResult } from './types'
const KANBAN_PAGE_SIZE = 40
const LEAD_SEARCH_LIMIT = 12
import client from "../../shared/http/client";
import type { ApiResponse, UntypedResponse } from '../../shared/http/contract'
import type { Chat, LeadActivity } from "../chats/types";
import type { BulkAssignTagInput, BulkMoveStageInput, CustomFieldDefinition, CustomFieldEntity, DashboardMetrics, DashboardScope, KanbanPage, KanbanSnapshot, LeadService, LeadStage, LeadStageAdminDefinition, LeadStageDefinition, LeadStageInput, LeadTask, MoveLeadStageInput, Tag, TaskInput, TaskStatus } from "./types";

export async function fetchLeadStages(): Promise<LeadStageDefinition[]> {
  return (await client.get<ApiResponse<'/api/lead-stages', 'get'>>('/api/lead-stages')).data
}

export async function fetchAdminLeadStages(): Promise<LeadStageAdminDefinition[]> {
  return (await client.get<ApiResponse<'/api/lead-stages/all', 'get'>>('/api/lead-stages/all')).data
}

export async function createLeadStage(values: LeadStageInput): Promise<LeadStageDefinition> {
  return (await client.post<ApiResponse<'/api/lead-stages', 'post'>>('/api/lead-stages', values)).data
}

export async function updateLeadStage({ key, ...values }: Partial<LeadStageInput> & { key: LeadStage; is_active?: boolean }): Promise<LeadStageDefinition> {
  return (await client.patch<ApiResponse<'/api/lead-stages/{key}', 'patch'>>(`/api/lead-stages/${encodeURIComponent(key)}`, values)).data
}

export async function reorderLeadStages(keys: LeadStage[]): Promise<LeadStageAdminDefinition[]> {
  return (await client.put<ApiResponse<'/api/lead-stages/order', 'put'>>('/api/lead-stages/order', { keys })).data
}

export async function deleteLeadStage(key: LeadStage) {
  await client.delete<ApiResponse<'/api/lead-stages/{key}', 'delete'>>(`/api/lead-stages/${encodeURIComponent(key)}`)
}

export async function fetchTags(includeInactive: boolean): Promise<Tag[]> {
  if (includeInactive) return (await client.get<ApiResponse<'/api/tags/all', 'get'>>('/api/tags/all')).data
  return (await client.get<ApiResponse<'/api/tags', 'get'>>('/api/tags')).data
}

export async function createTag(payload: { name: string; color: string }): Promise<Tag> {
  return (await client.post<ApiResponse<'/api/tags', 'post'>>('/api/tags', payload)).data
}

export async function updateTag({ id, ...values }: { id: number; name?: string; color?: string; is_active?: boolean }): Promise<Tag> {
  return (await client.patch<ApiResponse<'/api/tags/{tag_id}', 'patch'>>(`/api/tags/${id}`, values)).data
}

export async function assignTag(chatId: string, tagId: number): Promise<Chat> {
  return (await client.post<ApiResponse<'/api/chats/{chat_id}/tags/{tag_id}', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/tags/${tagId}`)).data
}

export async function removeTag(chatId: string, tagId: number): Promise<Chat> {
  return (await client.delete<ApiResponse<'/api/chats/{chat_id}/tags/{tag_id}', 'delete'>>(`/api/chats/${encodeURIComponent(chatId)}/tags/${tagId}`)).data
}

export async function fetchLeadActivity(chatId: string): Promise<LeadActivity[]> {
  return (await client.get<ApiResponse<'/api/chats/{chat_id}/activity', 'get'>>(`/api/chats/${encodeURIComponent(chatId)}/activity`)).data
}

export async function fetchLeadServices(includeInactive: boolean): Promise<LeadService[]> {
  if (includeInactive) return (await client.get<ApiResponse<'/api/services/all', 'get'>>('/api/services/all')).data
  return (await client.get<ApiResponse<'/api/services', 'get'>>('/api/services')).data
}

export async function createLeadService(name: string): Promise<LeadService> {
  return (await client.post<ApiResponse<'/api/services', 'post'>>('/api/services', { name })).data
}

export async function updateLeadService({ id, ...values }: {
      id: number
      name?: string
      is_active?: boolean
      description?: string
      price?: string | null
      price_notes?: string
    }): Promise<LeadService> {
  return (await client.patch<ApiResponse<'/api/services/{service_id}', 'patch'>>(`/api/services/${id}`, values)).data
}

export async function fetchCustomFields(entityType: CustomFieldEntity, includeInactive: boolean): Promise<CustomFieldDefinition[]> {
  return (await client.get<ApiResponse<'/api/custom-fields', 'get'>>('/api/custom-fields', {
      params: { entity_type: entityType, include_inactive: includeInactive },
    })).data
}

export async function createCustomField(values: Omit<CustomFieldDefinition, 'id' | 'key' | 'is_active'> & { key?: string }): Promise<CustomFieldDefinition> {
  return (await client.post<ApiResponse<'/api/custom-fields', 'post'>>('/api/custom-fields', values)).data
}

export async function updateCustomField({ id, ...values }: { id: number; label?: string; required?: boolean; options?: string[]; position?: number; is_active?: boolean }): Promise<CustomFieldDefinition> {
  return (await client.patch<ApiResponse<'/api/custom-fields/{field_id}', 'patch'>>(`/api/custom-fields/${id}`, values)).data
}

export async function fetchLeadCustomFieldValues(leadId: string) {
  return (await client.get<ApiResponse<'/api/custom-fields/lead-values/{lead_id}', 'get'>>(`/api/custom-fields/lead-values/${encodeURIComponent(leadId)}`)).data.values
}

export async function updateLeadCustomFieldValues(leadId: string, values: Record<string, unknown>) {
  return (await client.patch<ApiResponse<'/api/custom-fields/lead-values/{lead_id}', 'patch'>>(`/api/custom-fields/lead-values/${encodeURIComponent(leadId)}`, { values })).data.values
}

export async function fetchTasks(leadId: string | undefined, assignedUserId: number | undefined, allUsers: boolean): Promise<LeadTask[]> {
  return (await client.get<ApiResponse<'/api/tasks', 'get'>>('/api/tasks', {
      params: { status, lead_id: leadId, assigned_user_id: assignedUserId, all_users: allUsers || undefined },
    })).data
}

export async function createTask(input: TaskInput): Promise<LeadTask> {
  return (await client.post<ApiResponse<'/api/tasks', 'post'>>('/api/tasks', input)).data
}

export async function updateTask({ id, ...values }: Partial<TaskInput> & { id: number; status?: TaskStatus }): Promise<LeadTask> {
  return (await client.patch<ApiResponse<'/api/tasks/{task_id}', 'patch'>>(`/api/tasks/${id}`, values)).data
}

export async function completeAllTasks({ assignedUserId, allUsers }: { assignedUserId?: number; allUsers?: boolean }): Promise<{ completed: number }> {
  return (
      await client.post<UntypedResponse<'/api/tasks/complete-all', 'post', { completed: number }>>('/api/tasks/complete-all', undefined, {
        params: {
          assigned_user_id: assignedUserId,
          all_users: allUsers || undefined,
        },
      })
    ).data
}

export async function fetchKanbanSnapshot(search: string): Promise<KanbanSnapshot> {
  const { data } = await client.get<ApiResponse<'/api/chats/kanban/snapshot', 'get'>>('/api/chats/kanban/snapshot', {
    params: search ? { search } : undefined,
  })
  return data
}

export async function fetchKanbanStage(stage: LeadStage, search: string, offset: number): Promise<KanbanPage> {
  const { data } = await client.get<ApiResponse<'/api/chats/kanban/{stage}', 'get'>>(`/api/chats/kanban/${stage}`, {
    params: { offset, limit: KANBAN_PAGE_SIZE, ...(search ? { search } : {}) },
  })
  return data
}

export async function moveLeadStage({ chatId, stage, razonPerdido }: MoveLeadStageInput): Promise<Chat> {
  const { data } = await client.patch<ApiResponse<'/api/chats/{chat_id}/stage', 'patch'>>(`/api/chats/${encodeURIComponent(String(chatId))}/stage`, {
    stage,
    razon_perdido: razonPerdido ?? null,
  })
  return data
}

export function bulkMoveStage({ chatIds, stage, razonPerdido }: BulkMoveStageInput) {
  return runBulk(chatIds, (chatId) =>
        client.patch<ApiResponse<'/api/chats/{chat_id}/stage', 'patch'>>(`/api/chats/${encodeURIComponent(chatId)}/stage`, {
          stage,
          razon_perdido: razonPerdido ?? null,
        })
      )
}

export function bulkAssignTag({ chatIds, tagId }: BulkAssignTagInput) {
  return runBulk(chatIds, (chatId) => client.post<ApiResponse<'/api/chats/{chat_id}/tags/{tag_id}', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/tags/${tagId}`))
}

export async function fetchDashboard(days: number, scope: DashboardScope | null): Promise<DashboardMetrics> {
  return (
      await client.get<UntypedResponse<'/api/dashboard', 'get', DashboardMetrics>>('/api/dashboard', {
        // Sin scope el backend elige por rol: el vendedor ve lo suyo y el
        // admin el total del equipo.
        params: { days, ...(scope ? { scope } : {}) },
      })
    ).data
}

export async function searchLeads(search: string, signal?: AbortSignal) {
  return (
      await client.get<ApiResponse<'/api/chats', 'get'>>('/api/chats', { params: { search }, signal })
    ).data.items.slice(0, LEAD_SEARCH_LIMIT)
}

/** Dispara un request por lead en paralelo en vez de pedir un endpoint de
 * bulk al backend — no hay volumen para justificarlo (selecciones de a
 * decenas, no miles) y así se reusan los mismos endpoints de a uno que ya
 * están probados. Promise.allSettled para que un 404 suelto (un lead
 * borrado mientras tanto) no tire abajo el resto de la selección. */
async function runBulk<T>(chatIds: string[], run: (chatId: string) => Promise<T>): Promise<BulkActionResult> {
  const results = await Promise.allSettled(chatIds.map(run))
  const succeeded: string[] = []
  const failed: string[] = []
  results.forEach((result, i) => (result.status === 'fulfilled' ? succeeded : failed).push(chatIds[i]))
  return { succeeded, failed }
}
