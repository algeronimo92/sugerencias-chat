import axios from 'axios'

export function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err) && typeof err.response?.data?.detail === 'string') {
    return err.response.data.detail
  }
  return err instanceof Error ? err.message : 'Error desconocido'
}
