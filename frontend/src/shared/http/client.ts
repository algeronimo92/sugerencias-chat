import axios from 'axios'
import { ME_QUERY_KEY, queryClient } from '../queryClient'

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

// Si cualquier request devuelve 401 (cookie ausente/vencida), la sesión ya
// no es válida — se invalida el "me" en caché para que la app vuelva a
// mostrar el login, sin importar qué endpoint haya sido. No se descarta el
// resto de la caché: un 401 también es la respuesta normal de queries que
// viven sin sesión del CRM (la del panel de plataforma, el estado del PIN en
// el login), y borrarlas a mitad de vuelo las dejaría cargando para siempre.
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      queryClient.setQueryData(ME_QUERY_KEY, null)
    }
    return Promise.reject(error)
  }
)

export default client
