import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import client from '../api/client'
import type { SuggestionResponse, SuggestionStatus } from '../types'

interface GenerateParams {
  chat_id: string
  phone: string | null
  // Ignora la sugerencia guardada y pide un juego nuevo ("Generá otras").
  force?: boolean
}

async function generateSuggestions(params: GenerateParams): Promise<SuggestionResponse> {
  try {
    const { data } = await client.post<SuggestionResponse>('/api/suggestions', params)
    return data
  } catch (err) {
    // El backend manda el motivo en `detail`. Se re-lanza como Error normal
    // para que la UI muestre algo legible.
    if (axios.isAxiosError(err) && err.response?.data && typeof err.response.data === 'object') {
      const detail = (err.response.data as { detail?: unknown }).detail
      if (typeof detail === 'string') throw new Error(detail)
    }
    throw err
  }
}

/**
 * Estado de la sugerencia guardada del chat: lectura barata (GET) que NUNCA
 * dispara la generación con IA. Al abrir un lead con sugerencia previa se
 * muestra al instante y gratis; si no hay nada, la UI ofrece generarla.
 * Cuando llega un mensaje nuevo del cliente, useChatUpdates invalida esta
 * query y el refetch solo actualiza `stale` — la regeneración queda siempre
 * en manos del vendedor.
 */
export function useSuggestionStatus(chatId: string | null) {
  return useQuery({
    queryKey: ['suggestions', chatId],
    queryFn: async () => {
      const { data } = await client.get<SuggestionStatus>(
        `/api/suggestions/${encodeURIComponent(chatId as string)}`,
      )
      return data
    },
    enabled: !!chatId,
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * Generación a demanda: el único camino que llama a la IA. Sin `force`
 * aprovecha la sugerencia vigente del backend si existe (gratis) y genera
 * solo si falta o quedó desactualizada; con `force: true` ("Generá otras")
 * pide un juego nuevo ignorando lo guardado.
 */
export function useGenerateSuggestions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ['generate-suggestions'],
    mutationFn: (params: GenerateParams) => generateSuggestions(params),
    onSuccess: (data, variables) => {
      queryClient.setQueryData<SuggestionStatus>(['suggestions', variables.chat_id], {
        suggestion: data,
        generated_at: new Date().toISOString(),
        stale: false,
      })
      // La sugerencia pudo cambiar la etapa del lead / registrar actividad.
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', variables.chat_id] })
    },
  })
}
