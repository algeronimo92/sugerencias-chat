import client from '../../shared/http/client'
import type { ApiResponse } from '../../shared/http/contract'
import type { BulkActionResult, BulkAssignTagInput, BulkMoveStageInput, Chat, ChatFilters, ChatsPage, KanbanPage, KanbanSnapshot, LeadActivity, LeadInput, LeadStage, LeadStageAdminDefinition, LeadStageDefinition, LeadStageInput, LeadUpdateInput, MoveLeadStageInput, PageParam } from './types'

const KANBAN_PAGE_SIZE = 40
const LEAD_SEARCH_LIMIT = 12

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

export async function assignTag(chatId: string, tagId: number): Promise<Chat> {
  return (await client.post<ApiResponse<'/api/chats/{chat_id}/tags/{tag_id}', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/tags/${tagId}`)).data
}

export async function removeTag(chatId: string, tagId: number): Promise<Chat> {
  return (await client.delete<ApiResponse<'/api/chats/{chat_id}/tags/{tag_id}', 'delete'>>(`/api/chats/${encodeURIComponent(chatId)}/tags/${tagId}`)).data
}

export async function fetchLeadActivity(chatId: string): Promise<LeadActivity[]> {
  return (await client.get<ApiResponse<'/api/chats/{chat_id}/activity', 'get'>>(`/api/chats/${encodeURIComponent(chatId)}/activity`)).data
}

export async function fetchLeadCustomFieldValues(leadId: string) {
  return (await client.get<ApiResponse<'/api/custom-fields/lead-values/{lead_id}', 'get'>>(`/api/custom-fields/lead-values/${encodeURIComponent(leadId)}`)).data.values
}

export async function updateLeadCustomFieldValues(leadId: string, values: Record<string, unknown>) {
  return (await client.patch<ApiResponse<'/api/custom-fields/lead-values/{lead_id}', 'patch'>>(`/api/custom-fields/lead-values/${encodeURIComponent(leadId)}`, { values })).data.values
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

export async function fetchChatsPage(search: string, pageParam: PageParam, filters?: ChatFilters): Promise<ChatsPage> {
  const params: Record<string, string> = {}
  if (search) params.search = search
  if (filters?.unreadOnly) params.unread_only = 'true'
  if (filters?.stages.length) params.stages = filters.stages.join(',')
  if (filters?.tagIds.length) params.tag_ids = filters.tagIds.join(',')
  if (filters?.tagIds.length) params.tag_mode = filters.tagMode
  if (filters?.service.trim()) params.service = filters.service.trim()
  if (filters?.sellerId) params.seller_id = String(filters.sellerId)
  if (filters?.origin.trim()) params.origin = filters.origin.trim()
  if (filters?.lastSender) params.last_sender = filters.lastSender
  if (filters?.inactiveDays) params.inactive_days = String(filters.inactiveDays)
  if (filters?.waitingTime) params.waiting_time = filters.waitingTime
  if (filters?.automationPaused) params.automation_paused = 'true'
  if (pageParam) {
    params.cursor_id = String(pageParam.cursorId)
    if (pageParam.cursorTs) params.cursor_ts = pageParam.cursorTs
    if (search) params.cursor_rank = String(pageParam.cursorRank ?? 2)
  }
  const { data } = await client.get<ApiResponse<'/api/chats', 'get'>>('/api/chats', { params })
  return data
}

export async function fetchLeadByPhone(digits: string): Promise<Chat | null> {
  const { data } = await client.get<ApiResponse<'/api/chats', 'get'>>('/api/chats', { params: { search: digits } })
  return data.items.find((chat) => (chat.phone ?? '').replace(/\D/g, '').endsWith(digits)) ?? null
}

export async function createLead(payload: LeadInput): Promise<Chat> {
  const { data } = await client.post<ApiResponse<'/api/chats', 'post'>>('/api/chats', payload)
  return data
}

export async function updateLead(chatId: string, payload: LeadUpdateInput): Promise<Chat> {
  const { data } = await client.patch<ApiResponse<'/api/chats/{chat_id}', 'patch'>>(`/api/chats/${encodeURIComponent(chatId)}`, payload)
  return data
}

export async function markNoShow(chatId: string): Promise<Chat> {
  const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/no-show', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/no-show`)
  return data
}

export async function deleteLead(chatId: string): Promise<void> {
  await client.delete<ApiResponse<'/api/chats/{chat_id}', 'delete'>>(`/api/chats/${encodeURIComponent(chatId)}`)
}

export async function mergeLead(chatId: string, otherId: string): Promise<Chat> {
  const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/merge', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/merge`, { other_id: otherId })
  return data
}

export async function fetchChat(chatId: string | null): Promise<Chat> {
  return (await client.get<ApiResponse<'/api/chats/{chat_id}', 'get'>>(`/api/chats/${encodeURIComponent(chatId as string)}`)).data
}

export async function fetchPhoneConfig(): Promise<{ default_country_code: string }> {
  return (await client.get<ApiResponse<'/api/chats/phone-config', 'get'>>('/api/chats/phone-config')).data
}
