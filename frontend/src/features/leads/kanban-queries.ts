import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchKanbanSnapshot, fetchKanbanStage, moveLeadStage, bulkAssignSeller, bulkAssignTag, bulkMoveStage } from './api'
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

/** Una página de una etapa. `enabled` en falso cuando la página ya vino en
 *  el snapshot: así abrir el embudo no suma un pedido. Mientras llega la
 *  página siguiente se sigue mostrando la anterior, sin parpadeo. */
export function useKanbanStagePage(stage: LeadStage, search: string, offset: number, limit: number, enabled: boolean) {
  return useQuery({
    queryKey: kanbanKeys.stagePage(stage, search, offset, limit),
    queryFn: () => fetchKanbanStage(stage, search, offset, limit),
    enabled,
    staleTime: 20_000,
    placeholderData: keepPreviousData,
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

/** Asigna (o quita) la vendedora de varios chats. Lo que no se pudo vuelve en
 *  `failed`; el backend solo deja hacerlo a un admin. */
export function useBulkAssignSeller() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkAssignSeller,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadKeys.all })
      queryClient.invalidateQueries({ queryKey: kanbanKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.activityAll })
    },
  })
}
