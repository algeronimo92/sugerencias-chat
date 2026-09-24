import { QueryClient } from '@tanstack/react-query'

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
