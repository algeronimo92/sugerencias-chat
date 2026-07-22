import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'

export type WhatsappState =
  | 'open'
  | 'connecting'
  | 'close'
  | 'missing'
  | 'not_configured'
  | 'unknown'

export interface WhatsappStatus {
  state: WhatsappState
  instance: string | null
}

export interface WhatsappQr {
  base64: string | null
  code?: string | null
  pairing_code: string | null
  instance: string
  state?: WhatsappState
}

async function fetchStatus(): Promise<WhatsappStatus> {
  const { data } = await client.get<WhatsappStatus>('/api/whatsapp/status')
  return data
}

interface StatusOptions {
  enabled?: boolean
  // Reconsulta cada 3s hasta que la instancia queda vinculada (open). Se usa
  // mientras el panel de conexión está abierto para reflejar el escaneo del QR.
  pollUntilConnected?: boolean
}

export function useWhatsappStatus(options: StatusOptions = {}) {
  return useQuery({
    queryKey: ['whatsapp', 'status'],
    queryFn: fetchStatus,
    enabled: options.enabled ?? true,
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
    mutationFn: async (): Promise<WhatsappQr> =>
      (await client.post<WhatsappQr>('/api/whatsapp/connect')).data,
  })
}

export function useLogoutWhatsapp() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => (await client.post('/api/whatsapp/logout')).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['whatsapp', 'status'] }),
  })
}
