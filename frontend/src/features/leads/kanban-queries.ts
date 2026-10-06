import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchKanbanSnapshot, fetchKanbanStage, moveLeadStage, bulkAssignTag, bulkMoveStage } from './api'
import type { LeadStage } from './types'

export type { KanbanPage } from './types'

export type { KanbanSnapshot } from './types'

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

export type { BulkActionResult } from './types'

export function useBulkMoveStage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkMoveStage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban'] })
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity'] })
    },
  })
}

export function useBulkAssignTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkAssignTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['kanban'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity'] })
    },
  })
}
