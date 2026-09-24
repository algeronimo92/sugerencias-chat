import axios from 'axios'

/** `detail` llega como texto o, cuando la UI necesita distinguir el caso,
 * como `{ code, message }` (cuota del asistente, contexto desactualizado). */
export function detailMessage(detail: unknown): string | null {
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string') {
    return (detail as { message: string }).message
  }
  return null
}

export function extractErrorMessage(err: unknown): string {
  const detail = axios.isAxiosError(err) ? detailMessage(err.response?.data?.detail) : null
  if (detail) return detail
  // Sin response = nunca llegó al servidor (axios reporta "Network Error").
  if (axios.isAxiosError(err) && !err.response) {
    return 'Sin conexión con el servidor. Revisá tu internet e intentá de nuevo.'
  }
  return err instanceof Error ? err.message : 'Error desconocido'
}
