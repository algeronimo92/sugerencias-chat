import { asApiError } from '../../shared/http/errors'

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

export function toSuggestionError(err: unknown): SuggestionError {
  const apiError = asApiError(err)
  if (!apiError) return new SuggestionError(err instanceof Error ? err.message : 'Error desconocido', null)
  if (apiError.isNetwork) return new SuggestionError(apiError.message, null)
  // El backend manda el motivo en `detail`, como texto o como { code, message }.
  if (apiError.detail) return new SuggestionError(apiError.detail, apiError.code)
  // Sin detalle (un fallo inesperado del servidor o un proxy): nunca mostrar
  // "Request failed with status code 500".
  return new SuggestionError(
    apiError.status !== null && apiError.status >= 500
      ? 'El asistente IA no está disponible en este momento. Intenta de nuevo en unos minutos.'
      : 'No se pudieron generar las sugerencias.',
    null,
  )
}
