import axios from 'axios'
import { queryClient } from '../queryClient'

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

// Si cualquier request devuelve 401 (cookie ausente/vencida), la sesión ya
// no es válida — se invalida el "me" en caché para que la app vuelva a
// mostrar el login, sin importar qué endpoint haya sido.
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      queryClient.setQueryData(['auth', 'me'], null)
    }
    return Promise.reject(error)
  }
)

export default client
