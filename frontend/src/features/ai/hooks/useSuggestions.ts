import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SuggestionStatus } from '../../chats/types'
import { generateSuggestions, analyzeLead, fetchSuggestionStatus } from '../api'
import type { GenerateParams } from '../types'

/** Motivos por los que reintentar no sirve: los resuelve la plataforma
 * (plan, configuración) o el paso del tiempo (cuota del mes). */
export { SuggestionError } from '../errors'

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
    queryFn: () => fetchSuggestionStatus(chatId),
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
      queryClient.invalidateQueries({ queryKey: ['ai-assistant', 'usage'] })
    },
  })
}

/** Resultado del analista ya aplicado a la ficha del lead. */
export type { LeadAnalysisResult } from '../types'

/**
 * Análisis a pedido del vendedor: el workflow analista lee la conversación y
 * actualiza la ficha (etapa, objeción, servicio, notas…). Espera a que el
 * resultado quede aplicado, así que al volver la ficha ya está al día.
 */
export function useAnalyzeLead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ['analyze-lead'],
    mutationFn: analyzeLead,
    onSuccess: (_data, chatId) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
      queryClient.invalidateQueries({ queryKey: ['ai-assistant', 'usage'] })
    },
  })
}
