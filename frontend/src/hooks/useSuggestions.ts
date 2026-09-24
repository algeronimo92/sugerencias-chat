import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import client from '../api/client'
import { detailMessage } from '../utils/errors'
import type { LeadStage, SuggestionResponse, SuggestionStatus } from '../types'

interface GenerateParams {
  chat_id: string
  phone: string | null
  // Ignora la sugerencia guardada y pide un juego nuevo ("Generá otras").
  force?: boolean
  // Indicación opcional del asesor ("dar precio", "no dar precio"…). El
  // backend la sanea y la pasa al prompt; si viene, siempre genera de nuevo.
  instruction?: string
}

/** Motivos por los que reintentar no sirve: los resuelve la plataforma
 * (plan, configuración) o el paso del tiempo (cuota del mes). */
const NON_RETRYABLE_CODES = new Set([
  'ai_disabled',
  'ai_quota_exceeded',
  'ai_not_configured',
  'ai_workflow_rejected',
  'ai_workflow_misconfigured',
])

/** Error de generación listo para mostrar al vendedor. */
export class SuggestionError extends Error {
  readonly code: string | null
  readonly retryable: boolean

  constructor(message: string, code: string | null) {
    super(message)
    this.name = 'SuggestionError'
    this.code = code
    this.retryable = !code || !NON_RETRYABLE_CODES.has(code)
  }
}

function toSuggestionError(err: unknown): SuggestionError {
  if (!axios.isAxiosError<{ detail?: unknown }>(err)) {
    return new SuggestionError(err instanceof Error ? err.message : 'Error desconocido', null)
  }
  if (!err.response) {
    return new SuggestionError('Sin conexión con el servidor. Revisá tu internet e intentá de nuevo.', null)
  }
  // El backend manda el motivo en `detail`, como texto o como { code, message }.
  const detail = err.response.data?.detail
  const code = detail && typeof detail === 'object' && typeof (detail as { code?: unknown }).code === 'string'
    ? (detail as { code: string }).code
    : null
  const message = detailMessage(detail)
  if (message) return new SuggestionError(message, code)
  // Sin detalle (un fallo inesperado del servidor o un proxy): nunca mostrar
  // "Request failed with status code 500".
  return new SuggestionError(
    err.response.status >= 500
      ? 'El asistente IA no está disponible en este momento. Intenta de nuevo en unos minutos.'
      : 'No se pudieron generar las sugerencias.',
    null,
  )
}

async function generateSuggestions(params: GenerateParams): Promise<SuggestionResponse> {
  try {
    const { data } = await client.post<SuggestionResponse>('/api/suggestions', params)
    return data
  } catch (err) {
    throw toSuggestionError(err)
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
      queryClient.invalidateQueries({ queryKey: ['ai-assistant', 'usage'] })
    },
  })
}

/** Resultado del analista ya aplicado a la ficha del lead. */
export interface LeadAnalysisResult {
  changed?: boolean
  stage?: LeadStage | null
}

/**
 * Análisis a pedido del vendedor: el workflow analista lee la conversación y
 * actualiza la ficha (etapa, objeción, servicio, notas…). Espera a que el
 * resultado quede aplicado, así que al volver la ficha ya está al día.
 */
export function useAnalyzeLead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ['analyze-lead'],
    mutationFn: async (chatId: string) => {
      try {
        const { data } = await client.post<LeadAnalysisResult>('/api/suggestions/analyze', { chat_id: chatId })
        return data
      } catch (err) {
        throw toSuggestionError(err)
      }
    },
    onSuccess: (_data, chatId) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
      queryClient.invalidateQueries({ queryKey: ['ai-assistant', 'usage'] })
    },
  })
}
