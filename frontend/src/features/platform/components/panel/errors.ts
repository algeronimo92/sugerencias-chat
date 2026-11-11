import { asApiError } from '../../../../shared/http/errors'

export function mensajeDeError(error: unknown): string {
  const apiError = asApiError(error)
  if (apiError) {
    // El 404 puede venir del middleware de tenancy ("Tenant not found") antes
    // de llegar al panel: desde el dominio de un negocio estas rutas no
    // existen, y ese detalle genérico no le dice nada a quien lo lee. Un 404
    // con detalle propio (un negocio sin espacio listo) sí se muestra tal cual.
    if (apiError.status === 404 && (!apiError.detail || apiError.detail === 'Tenant not found')) {
      return 'El panel solo está disponible en el dominio de la plataforma.'
    }
    if (apiError.detail) return apiError.detail
  }
  return 'No se pudo completar la operación.'
}
