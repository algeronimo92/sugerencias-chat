import axios from 'axios'

export function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err) && typeof err.response?.data?.detail === 'string') {
    return err.response.data.detail
  }
  // Sin response = nunca llegó al servidor (axios reporta "Network Error").
  if (axios.isAxiosError(err) && !err.response) {
    return 'Sin conexión con el servidor. Revisá tu internet e intentá de nuevo.'
  }
  return err instanceof Error ? err.message : 'Error desconocido'
}
