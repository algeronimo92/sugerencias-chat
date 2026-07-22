import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import client from '../api/client'
import type { SuggestionResponse } from '../types'

interface Params {
  chat_id: string
  phone: string | null
  // Salta la sugerencia cacheada y le pide otra nueva a n8n.
  force?: boolean
}

async function fetchSuggestions(params: Params): Promise<SuggestionResponse> {
  try {
    const { data } = await client.post<SuggestionResponse>('/api/suggestions', params)
    return data
  } catch (err) {
    // El backend manda el motivo en `detail` (p. ej. "Error llamando n8n: ...").
    // Se re-lanza como Error normal para que la UI muestre algo legible.
    if (axios.isAxiosError(err) && err.response?.data && typeof err.response.data === 'object') {
      const detail = (err.response.data as { detail?: unknown }).detail
      if (typeof detail === 'string') throw new Error(detail)
    }
    throw err
  }
}

/**
 * Sugerencias de n8n para un chat, cacheadas por chat en el cliente.
 *
 * Reabrir un lead ya visto no dispara el spinner "Consultando n8n...":
 * react-query devuelve la última respuesta al instante y solo revalida en
 * segundo plano si quedó obsoleta (staleTime). La caché se invalida al llegar
 * un mensaje nuevo del cliente (ver useChatUpdates en useChats.ts), para que
 * la vista se actualice y no quede mostrando una recomendación vieja.
 */
export function useSuggestions(chatId: string | null, phone: string | null) {
  return useQuery({
    queryKey: ['suggestions', chatId],
    queryFn: () => fetchSuggestions({ chat_id: chatId as string, phone }),
    enabled: !!chatId,
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * "Pedir otras": fuerza a n8n a generar un juego nuevo ignorando la caché del
 * backend y sobreescribe la sugerencia cacheada del chat con el resultado.
 */
export function useRefreshSuggestions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { chat_id: string; phone: string | null }) =>
      fetchSuggestions({ ...params, force: true }),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['suggestions', variables.chat_id], data)
      // La sugerencia pudo cambiar la etapa del lead / registrar actividad.
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', variables.chat_id] })
    },
  })
}
