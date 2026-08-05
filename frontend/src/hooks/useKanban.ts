import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { Chat, LeadStage } from '../types'

const KANBAN_PAGE_SIZE = 40

export interface KanbanPage {
  items: Chat[]
  has_more: boolean
}

export interface KanbanSnapshot {
  counts: Record<LeadStage, number>
  stages: Record<LeadStage, KanbanPage>
}

async function fetchKanbanSnapshot(search: string): Promise<KanbanSnapshot> {
  const { data } = await client.get<KanbanSnapshot>('/api/chats/kanban/snapshot', {
    params: search ? { search } : undefined,
  })
  return data
}

async function fetchKanbanStage(stage: LeadStage, search: string, offset: number): Promise<KanbanPage> {
  const { data } = await client.get<KanbanPage>(`/api/chats/kanban/${stage}`, {
    params: { offset, limit: KANBAN_PAGE_SIZE, ...(search ? { search } : {}) },
  })
  return data
}

export function useKanbanSnapshot(search: string) {
  return useQuery({
    queryKey: ['kanban', 'snapshot', search],
    queryFn: () => fetchKanbanSnapshot(search),
    staleTime: 20_000,
    retry: false,
  })
}

export function useLoadKanbanStage() {
  return useMutation({
    mutationFn: ({ stage, search, offset }: { stage: LeadStage; search: string; offset: number }) =>
      fetchKanbanStage(stage, search, offset),
  })
}

interface MoveLeadStageInput {
  chatId: string
  stage: LeadStage
  /** Solo se persiste al pasar a `perdido`; el backend la ignora si no. */
  razonPerdido?: string | null
}

async function moveLeadStage({ chatId, stage, razonPerdido }: MoveLeadStageInput): Promise<Chat> {
  const { data } = await client.patch<Chat>(`/api/chats/${encodeURIComponent(String(chatId))}/stage`, {
    stage,
    razon_perdido: razonPerdido ?? null,
  })
  return data
}

export function useMoveLeadStage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: moveLeadStage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban'] })
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity'] })
    },
  })
}

export interface BulkActionResult {
  succeeded: string[]
  failed: string[]
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

interface BulkMoveStageInput {
  chatIds: string[]
  stage: LeadStage
  razonPerdido?: string | null
}

export function useBulkMoveStage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ chatIds, stage, razonPerdido }: BulkMoveStageInput) =>
      runBulk(chatIds, (chatId) =>
        client.patch(`/api/chats/${encodeURIComponent(chatId)}/stage`, {
          stage,
          razon_perdido: razonPerdido ?? null,
        })
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban'] })
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity'] })
    },
  })
}

interface BulkAssignTagInput {
  chatIds: string[]
  tagId: number
}

export function useBulkAssignTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ chatIds, tagId }: BulkAssignTagInput) =>
      runBulk(chatIds, (chatId) => client.post(`/api/chats/${encodeURIComponent(chatId)}/tags/${tagId}`)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['kanban'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity'] })
    },
  })
}
