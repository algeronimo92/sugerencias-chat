import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { connectEvolution, fetchEvolutionStatus, fetchStatus, fetchWhatsappCosts, removeEvolution, syncWhatsappCosts } from '../api'
import type { StatusOptions } from '../types'
import { whatsappKeys } from '../keys'

export type { WhatsappState } from '../types'

export type { WhatsappStatus } from '../types'

export function useWhatsappStatus(options: StatusOptions = {}) {
  return useQuery({
    queryKey: whatsappKeys.status,
    queryFn: fetchStatus,
    enabled: options.enabled ?? true,
    // Refleja una conexión externa sin evento de WebSocket: siempre se
    // reconsulta al montar, a diferencia del staleTime global.
    staleTime: 0,
    refetchInterval: options.pollUntilConnected
      ? (query) => {
          const state = query.state.data?.state
          // Ya vinculada o sin credenciales: no tiene sentido seguir sondeando.
          return state === 'open' || state === 'not_configured' ? false : 3000
        }
      : false,
  })
}

export function useEvolutionStatus() {
  return useQuery({
    queryKey: whatsappKeys.evolution,
    queryFn: fetchEvolutionStatus,
    staleTime: 0,
    refetchInterval: query => query.state.data?.state === 'connecting' ? 3000 : false,
  })
}

export function useConnectEvolution() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: connectEvolution,
    onSuccess: data => queryClient.setQueryData(whatsappKeys.evolution, data),
  })
}

export function useRemoveEvolution() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: removeEvolution,
    onSuccess: data => queryClient.setQueryData(whatsappKeys.evolution, data),
  })
}

/** Lo que Meta informó que cobró en el mes. Lo copia un worker cada pocas
 *  horas: no hay evento en tiempo real, así que no se reconsulta solo. */
export function useWhatsappCosts(month: string, enabled = true) {
  return useQuery({
    queryKey: whatsappKeys.costs(month),
    queryFn: () => fetchWhatsappCosts(month),
    enabled,
  })
}

export function useSyncWhatsappCosts(month: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => syncWhatsappCosts(month),
    onSuccess: (data) => {
      queryClient.setQueryData(whatsappKeys.costs(month), data)
      // Otros meses pueden haber cambiado con la misma sincronización.
      void queryClient.invalidateQueries({ queryKey: whatsappKeys.costsAll, refetchType: 'none' })
    },
  })
}
