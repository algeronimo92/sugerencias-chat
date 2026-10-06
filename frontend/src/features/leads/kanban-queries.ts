import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { fetchKanbanSnapshot,fetchKanbanStage,moveLeadStage,bulkAssignTag,bulkMoveStage } from './api'
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

/** Dispara un request por lead en paralelo en vez de pedir un endpoint de
 * bulk al backend — no hay volumen para justificarlo (selecciones de a
 * decenas, no miles) y así se reusan los mismos endpoints de a uno que ya
 * están probados. Promise.allSettled para que un 404 suelto (un lead
 * borrado mientras tanto) no tire abajo el resto de la selección. */




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
