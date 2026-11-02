import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchKanbanSnapshot, fetchKanbanStage, moveLeadStage, bulkAssignTag, bulkMoveStage } from './api'
import type { LeadStage } from './types'
import { kanbanKeys, leadKeys } from './keys'

export type { KanbanPage } from './types'

export type { KanbanSnapshot } from './types'

export function useKanbanSnapshot(search: string) {
  return useQuery({
    queryKey: kanbanKeys.snapshot(search),
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
      queryClient.invalidateQueries({ queryKey: kanbanKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.activityAll })
    },
  })
}

export type { BulkActionResult } from './types'

export function useBulkMoveStage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkMoveStage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: kanbanKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.activityAll })
    },
  })
}

export function useBulkAssignTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkAssignTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadKeys.all })
      queryClient.invalidateQueries({ queryKey: kanbanKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.activityAll })
    },
  })
}
