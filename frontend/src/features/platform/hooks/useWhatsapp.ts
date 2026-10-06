import { useQuery } from '@tanstack/react-query'
import { fetchStatus } from '../api'
import type { StatusOptions } from '../types'

export type { WhatsappState } from '../types'

export type { WhatsappStatus } from '../types'

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
