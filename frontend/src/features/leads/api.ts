import type { BulkActionResult } from './types'
const KANBAN_PAGE_SIZE = 40
const LEAD_SEARCH_LIMIT = 12
import client from "../../shared/http/client";
import type { Chat, LeadActivity } from "../chats/types";
import type { BulkAssignTagInput, BulkMoveStageInput, CustomFieldDefinition, CustomFieldEntity, DashboardMetrics, DashboardScope, KanbanPage, KanbanSnapshot, LeadService, LeadStage, LeadStageAdminDefinition, LeadStageDefinition, LeadStageInput, LeadTask, MoveLeadStageInput, Tag, TaskInput, TaskStatus } from "./types";

export async function fetchLeadStages() {
  return (await client.get<LeadStageDefinition[]>('/api/lead-stages')).data
}

export async function fetchAdminLeadStages() {
  return (await client.get<LeadStageAdminDefinition[]>('/api/lead-stages/all')).data
}

export async function createLeadStage(values: LeadStageInput) {
  return (await client.post<LeadStageDefinition>('/api/lead-stages', values)).data
}

export async function updateLeadStage({ key, ...values }: Partial<LeadStageInput> & { key: LeadStage; is_active?: boolean }) {
  return (await client.patch<LeadStageDefinition>(`/api/lead-stages/${encodeURIComponent(key)}`, values)).data
}

export async function reorderLeadStages(keys: LeadStage[]) {
  return (await client.put<LeadStageAdminDefinition[]>('/api/lead-stages/order', { keys })).data
}

export async function deleteLeadStage(key: LeadStage) {
      await client.delete(`/api/lead-stages/${encodeURIComponent(key)}`)
    }

export async function fetchTags(includeInactive: boolean) {
  return (await client.get<Tag[]>(includeInactive ? '/api/tags/all' : '/api/tags')).data
}

export async function createTag(payload: { name: string; color: string }) {
  return (await client.post<Tag>('/api/tags', payload)).data
}

export async function updateTag({ id, ...values }: { id: number; name?: string; color?: string; is_active?: boolean }) {
  return (await client.patch<Tag>(`/api/tags/${id}`, values)).data
}

export async function assignTag(chatId: string, tagId: number) {
  return (await client.post<Chat>(`/api/chats/${encodeURIComponent(chatId)}/tags/${tagId}`)).data
}

export async function removeTag(chatId: string, tagId: number) {
  return (await client.delete<Chat>(`/api/chats/${encodeURIComponent(chatId)}/tags/${tagId}`)).data
}

export async function fetchLeadActivity(chatId: string) {
  return (await client.get<LeadActivity[]>(`/api/chats/${encodeURIComponent(chatId)}/activity`)).data
}

export async function fetchLeadServices(includeInactive: boolean) {
  return (await client.get<LeadService[]>(includeInactive ? '/api/services/all' : '/api/services')).data
}

export async function createLeadService(name: string) {
  return (await client.post<LeadService>('/api/services', { name })).data
}

export async function updateLeadService({ id, ...values }: {
      id: number
      name?: string
      is_active?: boolean
      description?: string
      price?: string | null
      price_notes?: string
    }) {
  return (await client.patch<LeadService>(`/api/services/${id}`, values)).data
}

export async function fetchCustomFields(entityType: CustomFieldEntity, includeInactive: boolean) {
  return (await client.get<CustomFieldDefinition[]>('/api/custom-fields', {
      params: { entity_type: entityType, include_inactive: includeInactive },
    })).data
}

export async function createCustomField(values: Omit<CustomFieldDefinition, 'id' | 'key' | 'is_active'> & { key?: string }) {
  return (await client.post<CustomFieldDefinition>('/api/custom-fields', values)).data
}

export async function updateCustomField({ id, ...values }: { id: number; label?: string; required?: boolean; options?: string[]; position?: number; is_active?: boolean }) {
  return (await client.patch<CustomFieldDefinition>(`/api/custom-fields/${id}`, values)).data
}

export async function fetchLeadCustomFieldValues(leadId: string) {
  return (await client.get<{ values: Record<string, unknown> }>(`/api/custom-fields/lead-values/${encodeURIComponent(leadId)}`)).data.values
}

export async function updateLeadCustomFieldValues(leadId: string, values: Record<string, unknown>) {
  return (await client.patch<{ values: Record<string, unknown> }>(`/api/custom-fields/lead-values/${encodeURIComponent(leadId)}`, { values })).data.values
}

export async function fetchTasks(leadId: string | undefined, assignedUserId: number | undefined, allUsers: boolean) {
  return (await client.get<LeadTask[]>('/api/tasks', {
      params: { status, lead_id: leadId, assigned_user_id: assignedUserId, all_users: allUsers || undefined },
    })).data
}

export async function createTask(input: TaskInput) {
  return (await client.post<LeadTask>('/api/tasks', input)).data
}

export async function updateTask({ id, ...values }: Partial<TaskInput> & { id: number; status?: TaskStatus }) {
  return (await client.patch<LeadTask>(`/api/tasks/${id}`, values)).data
}

export async function completeAllTasks({ assignedUserId, allUsers }: { assignedUserId?: number; allUsers?: boolean }) {
  return (
      await client.post<{ completed: number }>('/api/tasks/complete-all', undefined, {
        params: {
          assigned_user_id: assignedUserId,
          all_users: allUsers || undefined,
        },
      })
    ).data
}

export async function fetchKanbanSnapshot(search: string): Promise<KanbanSnapshot> {
  const { data } = await client.get<KanbanSnapshot>('/api/chats/kanban/snapshot', {
    params: search ? { search } : undefined,
  })
  return data
}

export async function fetchKanbanStage(stage: LeadStage, search: string, offset: number): Promise<KanbanPage> {
  const { data } = await client.get<KanbanPage>(`/api/chats/kanban/${stage}`, {
    params: { offset, limit: KANBAN_PAGE_SIZE, ...(search ? { search } : {}) },
  })
  return data
}

export async function moveLeadStage({ chatId, stage, razonPerdido }: MoveLeadStageInput): Promise<Chat> {
  const { data } = await client.patch<Chat>(`/api/chats/${encodeURIComponent(String(chatId))}/stage`, {
    stage,
    razon_perdido: razonPerdido ?? null,
  })
  return data
}

export function bulkMoveStage({ chatIds, stage, razonPerdido }: BulkMoveStageInput) {
  return runBulk(chatIds, (chatId) =>
        client.patch(`/api/chats/${encodeURIComponent(chatId)}/stage`, {
          stage,
          razon_perdido: razonPerdido ?? null,
        })
      )
}

export function bulkAssignTag({ chatIds, tagId }: BulkAssignTagInput) {
  return runBulk(chatIds, (chatId) => client.post(`/api/chats/${encodeURIComponent(chatId)}/tags/${tagId}`))
}

export async function fetchDashboard(days: number, scope: DashboardScope | null) {
  return (
      await client.get<DashboardMetrics>('/api/dashboard', {
        // Sin scope el backend elige por rol: el vendedor ve lo suyo y el
        // admin el total del equipo.
        params: { days, ...(scope ? { scope } : {}) },
      })
    ).data
}

export async function searchLeads(search: string, signal?: AbortSignal) {
  return (
      await client.get<{ items: Chat[] }>('/api/chats', { params: { search }, signal })
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
