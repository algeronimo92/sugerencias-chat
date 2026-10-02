import type { BulkActionResult } from './types'
const KANBAN_PAGE_SIZE = 40
const LEAD_SEARCH_LIMIT = 12
import client from "../../shared/http/client";
import type { Chat,LeadActivity } from "../chats/types";
import type { BulkAssignTagInput,BulkMoveStageInput,CustomFieldDefinition,CustomFieldEntity,DashboardMetrics,DashboardScope,KanbanPage,KanbanSnapshot,LeadService,LeadStage,LeadStageAdminDefinition,LeadStageDefinition,LeadStageInput,LeadTask,MoveLeadStageInput,Tag,TaskInput,TaskStatus } from "./types";

export function requestLeadStages() {
  return async () => (await client.get<LeadStageDefinition[]>('/api/lead-stages')).data
}

export function requestAdminLeadStages() {
  return async () => (await client.get<LeadStageAdminDefinition[]>('/api/lead-stages/all')).data
}

export function requestCreateLeadStage() {
  return async (values: LeadStageInput) =>
      (await client.post<LeadStageDefinition>('/api/lead-stages', values)).data
}

export function requestUpdateLeadStage() {
  return async ({ key, ...values }: Partial<LeadStageInput> & { key: LeadStage; is_active?: boolean }) =>
      (await client.patch<LeadStageDefinition>(`/api/lead-stages/${encodeURIComponent(key)}`, values)).data
}

export function requestReorderLeadStages() {
  return async (keys: LeadStage[]) =>
      (await client.put<LeadStageAdminDefinition[]>('/api/lead-stages/order', { keys })).data
}

export function requestDeleteLeadStage() {
  return async (key: LeadStage) => {
      await client.delete(`/api/lead-stages/${encodeURIComponent(key)}`)
    }
}

export function requestTags(includeInactive: boolean) {
  return async () => (await client.get<Tag[]>(includeInactive ? '/api/tags/all' : '/api/tags')).data
}

export function requestCreateTag() {
  return async (payload: { name: string; color: string }) =>
      (await client.post<Tag>('/api/tags', payload)).data
}

export function requestUpdateTag() {
  return async ({ id, ...values }: { id: number; name?: string; color?: string; is_active?: boolean }) =>
      (await client.patch<Tag>(`/api/tags/${id}`, values)).data
}

export function requestAssignTag(chatId: string) {
  return async (tagId: number) =>
      (await client.post<Chat>(`/api/chats/${encodeURIComponent(chatId)}/tags/${tagId}`)).data
}

export function requestRemoveTag(chatId: string) {
  return async (tagId: number) =>
      (await client.delete<Chat>(`/api/chats/${encodeURIComponent(chatId)}/tags/${tagId}`)).data
}

export function requestLeadActivity(chatId: string) {
  return async () =>
      (await client.get<LeadActivity[]>(`/api/chats/${encodeURIComponent(chatId)}/activity`)).data
}

export function requestLeadServices(includeInactive: boolean) {
  return async () => (await client.get<LeadService[]>(includeInactive ? '/api/services/all' : '/api/services')).data
}

export function requestCreateLeadService() {
  return async (name: string) =>
      (await client.post<LeadService>('/api/services', { name })).data
}

export function requestUpdateLeadService() {
  return async ({ id, ...values }: {
      id: number
      name?: string
      is_active?: boolean
      description?: string
      price?: string | null
      price_notes?: string
    }) =>
      (await client.patch<LeadService>(`/api/services/${id}`, values)).data
}

export function requestCustomFields(entityType: CustomFieldEntity, includeInactive: boolean) {
  return async () => (await client.get<CustomFieldDefinition[]>('/api/custom-fields', {
      params: { entity_type: entityType, include_inactive: includeInactive },
    })).data
}

export function requestCreateCustomField() {
  return async (values: Omit<CustomFieldDefinition, 'id' | 'key' | 'is_active'> & { key?: string }) =>
      (await client.post<CustomFieldDefinition>('/api/custom-fields', values)).data
}

export function requestUpdateCustomField() {
  return async ({ id, ...values }: { id: number; label?: string; required?: boolean; options?: string[]; position?: number; is_active?: boolean }) =>
      (await client.patch<CustomFieldDefinition>(`/api/custom-fields/${id}`, values)).data
}

export function requestLeadCustomFieldValues(leadId: string) {
  return async () => (await client.get<{ values: Record<string, unknown> }>(`/api/custom-fields/lead-values/${encodeURIComponent(leadId)}`)).data.values
}

export function requestUpdateLeadCustomFieldValues(leadId: string) {
  return async (values: Record<string, unknown>) =>
      (await client.patch<{ values: Record<string, unknown> }>(`/api/custom-fields/lead-values/${encodeURIComponent(leadId)}`, { values })).data.values
}

export function requestTasks(leadId: string | undefined, assignedUserId: number | undefined, allUsers: boolean) {
  return async () => (await client.get<LeadTask[]>('/api/tasks', {
      params: { status, lead_id: leadId, assigned_user_id: assignedUserId, all_users: allUsers || undefined },
    })).data
}

export function requestCreateTask() {
  return async (input: TaskInput) => (await client.post<LeadTask>('/api/tasks', input)).data
}

export function requestUpdateTask() {
  return async ({ id, ...values }: Partial<TaskInput> & { id: number; status?: TaskStatus }) =>
      (await client.patch<LeadTask>(`/api/tasks/${id}`, values)).data
}

export function requestCompleteAllTasks() {
  return async ({ assignedUserId, allUsers }: { assignedUserId?: number; allUsers?: boolean }) => (
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

export function requestBulkMoveStage() {
  return ({ chatIds, stage, razonPerdido }: BulkMoveStageInput) =>
      runBulk(chatIds, (chatId) =>
        client.patch(`/api/chats/${encodeURIComponent(chatId)}/stage`, {
          stage,
          razon_perdido: razonPerdido ?? null,
        })
      )
}

export function requestBulkAssignTag() {
  return ({ chatIds, tagId }: BulkAssignTagInput) =>
      runBulk(chatIds, (chatId) => client.post(`/api/chats/${encodeURIComponent(chatId)}/tags/${tagId}`))
}

export function requestDashboard(days: number, scope: DashboardScope | null) {
  return async () =>
    (
      await client.get<DashboardMetrics>('/api/dashboard', {
        // Sin scope el backend elige por rol: el vendedor ve lo suyo y el
        // admin el total del equipo.
        params: { days, ...(scope ? { scope } : {}) },
      })
    ).data
}

export function requestLeadSearch(search: string) {
  return async ({ signal }: { signal: AbortSignal }) => (
      await client.get<{ items: Chat[] }>('/api/chats', { params: { search }, signal })
    ).data.items.slice(0, LEAD_SEARCH_LIMIT)
}

async function runBulk<T>(chatIds: string[], run: (chatId: string) => Promise<T>): Promise<BulkActionResult> {
  const results = await Promise.allSettled(chatIds.map(run))
  const succeeded: string[] = []
  const failed: string[] = []
  results.forEach((result, i) => (result.status === 'fulfilled' ? succeeded : failed).push(chatIds[i]))
  return { succeeded, failed }
}
