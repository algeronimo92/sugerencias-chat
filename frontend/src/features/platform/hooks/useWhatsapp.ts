import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchStatus, connectWhatsapp, logoutWhatsapp } from '../api'
import type { StatusOptions } from '../types'

export type { WhatsappState } from '../types'

export type { WhatsappStatus } from '../types'

export type { WhatsappQr } from '../types'

export function useWhatsappStatus(options: StatusOptions = {}) {
  return useQuery({
    queryKey: ['whatsapp', 'status'],
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

export function useConnectWhatsapp() {
  return useMutation({
    mutationFn: connectWhatsapp,
  })
}

export function useLogoutWhatsapp() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: logoutWhatsapp,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['whatsapp', 'status'] }),
  })
}
