import { QueryClient } from '@tanstack/react-query'

export const ME_QUERY_KEY = ['auth', 'me'] as const

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Mantiene en memoria los datos de los chats ya abiertos durante la
      // sesión (mensajes, sugerencias, etc.) para que reabrirlos sea
      // instantáneo. El default de react-query los descarta a los 5 min de
      // inactividad, lo que obligaba a recargar con spinner al volver.
      gcTime: 30 * 60 * 1000,
      // Con el default (0) cada montaje y cada vuelta a la pestaña repetía
      // todas las consultas activas. Los cambios reales llegan por WebSocket
      // (que invalida las queries afectadas y resincroniza al reconectar), así
      // que 30 s de frescura no dejan datos viejos a la vista. Las queries que
      // necesitan otro valor lo declaran en su hook.
      staleTime: 30_000,
    },
  },
})

/** Termina la sesión del lado del cliente: vuelve al login y descarta la
 * caché de esa sesión.
 *
 * El orden importa. ``clear()`` primero dejaba la app en el CRM: borraba la
 * query de ``/me`` que observa la guarda de sesión, y el ``null`` posterior
 * caía en una query nueva que nadie observaba, así que la pantalla no cambiaba
 * hasta el próximo re-render (por ejemplo, volver a enfocar la pestaña). Ahora
 * se marca la sesión como cerrada sobre la query existente y después se
 * descarta el resto. */
export function endSession(client: QueryClient = queryClient) {
  client.setQueryData(ME_QUERY_KEY, null)
  client.removeQueries({ predicate: query => !(query.queryKey[0] === ME_QUERY_KEY[0] && query.queryKey[1] === ME_QUERY_KEY[1]) })
  client.getMutationCache().clear()
}
