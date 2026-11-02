/**
 * El error de un pedido HTTP, sin axios. El cliente compartido convierte a
 * esto todo fallo de red o de respuesta, así el resto de la app pregunta por
 * `status` y `code` en vez de leer la forma de un error de axios o comparar
 * textos.
 */

import axios from 'axios'

const NETWORK_MESSAGE = 'Sin conexión con el servidor. Revisá tu internet e intentá de nuevo.'

export class ApiError extends Error {
  /** Status HTTP; null si el pedido no llegó al servidor. */
  readonly status: number | null
  /** Causa tipada que manda el backend (`code` de un DomainError, o el de un
   *  `detail` con forma `{ code, message }`). */
  readonly code: string | null
  /** Mensaje del servidor listo para mostrar, si mandó uno. */
  readonly detail: string | null

  constructor({ status, code = null, detail = null }: { status: number | null; code?: string | null; detail?: string | null }) {
    super(detail ?? (status === null ? NETWORK_MESSAGE : `Error HTTP ${status}`))
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }

  /** El pedido no llegó al servidor (sin internet, servidor caído, CORS). */
  get isNetwork(): boolean {
    return this.status === null
  }
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** `detail` llega como texto o, cuando la UI necesita distinguir el caso,
 *  como `{ code, message }`. Los errores de validación (422 de FastAPI) traen
 *  una lista: no es un mensaje para el usuario. */
function readBody(body: unknown): { detail: string | null; code: string | null } {
  if (!body || typeof body !== 'object') return { detail: null, code: null }
  const { detail, code } = body as { detail?: unknown; code?: unknown }
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const nested = detail as { message?: unknown; code?: unknown }
    return { detail: textOf(nested.message), code: textOf(nested.code) ?? textOf(code) }
  }
  return { detail: textOf(detail), code: textOf(code) }
}

/** El ApiError de un fallo HTTP; null si `error` no vino de un pedido. */
export function asApiError(error: unknown): ApiError | null {
  if (error instanceof ApiError) return error
  if (!axios.isAxiosError(error)) return null
  if (!error.response) return new ApiError({ status: null })
  return new ApiError({ status: error.response.status, ...readBody(error.response.data) })
}
