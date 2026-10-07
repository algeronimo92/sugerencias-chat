import { asApiError } from '../http/errors'

/** Texto para mostrarle al usuario ante cualquier error: el mensaje del
 *  servidor si mandó uno, y si no, uno genérico según el caso (nunca un
 *  "Request failed with status code 500"). */
export function extractErrorMessage(err: unknown): string {
  const apiError = asApiError(err)
  if (apiError) {
    if (apiError.detail) return apiError.detail
    if (apiError.isNetwork) return apiError.message
    return apiError.status !== null && apiError.status >= 500
      ? 'El servidor tuvo un problema. Intentá de nuevo en unos minutos.'
      : 'No se pudo completar la operación.'
  }
  return err instanceof Error ? err.message : 'Error desconocido'
}
