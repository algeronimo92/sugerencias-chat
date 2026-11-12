import { useQuery, type QueryClient } from '@tanstack/react-query'

import client from './http/client'
import type { ApiResponse } from './http/contract'
import { asApiError } from './http/errors'
import { ME_QUERY_KEY } from './queryClient'
import type { AuthUser } from './types'

/** Cuánto espera la primera consulta de sesión antes de darse por sin conexión.
 *
 * Sin límite, un equipo que no alcanza el servidor se quedaba en el spinner de
 * arranque sin explicación: el service worker sirve la app desde caché y el
 * pedido queda colgado hasta que el navegador se rinde (2026-11-12: un usuario
 * mandó la captura del spinner y hubo que ir a los logs para saber que su PC
 * ni llegaba al servidor). Con el límite, ve el aviso de conexión y puede
 * reintentar. */
export const SESSION_CHECK_TIMEOUT_MS = 15_000

async function fetchMe({ client: queries }: { client: QueryClient }): Promise<AuthUser | null> {
  // Solo mientras no se sabe nada de la sesión, que es cuando hay un spinner
  // tapando todo. Con la app ya abierta la consulta se repite en segundo plano
  // (al volver a la pestaña), y cortarla ahí cambiaría el CRM por el aviso de
  // conexión a quien solo tiene mala señal.
  const isFirstCheck = queries.getQueryData(ME_QUERY_KEY) === undefined
  try {
    const { data } = await client.get<ApiResponse<'/api/auth/me', 'get'>>('/api/auth/me', {
      timeout: isFirstCheck ? SESSION_CHECK_TIMEOUT_MS : 0,
    })
    return data
  } catch (error) {
    if (asApiError(error)?.status === 401) return null
    throw error
  }
}

export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    staleTime: 5 * 60_000,
    retry: false,
  })
}
