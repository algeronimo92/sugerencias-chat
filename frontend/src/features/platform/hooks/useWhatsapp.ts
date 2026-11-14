import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMetaConversionEvents, fetchMetaConversions, fetchStatus, fetchWhatsappCosts, saveMetaConversions, syncWhatsappCosts } from '../api'
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

/** Eventos de leads de anuncios informados a la API de Conversiones. El
 *  worker los manda en segundos: mientras queda alguno en cola se reconsulta. */
export function useMetaConversions(enabled = true) {
  return useQuery({
    queryKey: whatsappKeys.conversions,
    queryFn: fetchMetaConversions,
    enabled,
    refetchInterval: (query) => (query.state.data?.events.some((row) => row.pending > 0) ? 10_000 : false),
  })
}

export const CONVERSION_EVENTS_PAGE_SIZE = 20

/** Una página del historial de eventos; se pide solo con el modal abierto. */
export function useMetaConversionEvents(page: number, enabled = true) {
  return useQuery({
    queryKey: whatsappKeys.conversionEvents(page),
    queryFn: () => fetchMetaConversionEvents(page, CONVERSION_EVENTS_PAGE_SIZE),
    enabled,
    placeholderData: keepPreviousData,
  })
}

export function useSaveMetaConversions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveMetaConversions,
    onSuccess: (data) => queryClient.setQueryData(whatsappKeys.conversions, data),
  })
}
