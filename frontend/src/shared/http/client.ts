import axios from 'axios'
import { API_BASE_URL } from '../config'
import { ME_QUERY_KEY, queryClient } from '../queryClient'
import { asApiError } from './errors'

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

// Todo fallo sale de acá como ApiError: nadie fuera de shared/http conoce la
// forma de un error de axios.
//
// Si cualquier request devuelve 401 (cookie ausente/vencida), la sesión ya
// no es válida — se invalida el "me" en caché para que la app vuelva a
// mostrar el login, sin importar qué endpoint haya sido. No se descarta el
// resto de la caché: un 401 también es la respuesta normal de queries que
// viven sin sesión del CRM (la del panel de plataforma, el estado del PIN en
// el login), y borrarlas a mitad de vuelo las dejaría cargando para siempre.
client.interceptors.response.use(
  (response) => response,
  (error) => {
    // Un pedido cancelado (AbortSignal) no es un fallo: se deja pasar tal cual.
    if (axios.isCancel(error)) return Promise.reject(error)
    const apiError = asApiError(error)
    if (apiError?.status === 401) queryClient.setQueryData(ME_QUERY_KEY, null)
    return Promise.reject(apiError ?? error)
  }
)

export default client
