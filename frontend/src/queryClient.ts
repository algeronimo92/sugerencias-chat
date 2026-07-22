import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Mantiene en memoria los datos de los chats ya abiertos durante la
      // sesión (mensajes, sugerencias, etc.) para que reabrirlos sea
      // instantáneo. El default de react-query los descarta a los 5 min de
      // inactividad, lo que obligaba a recargar con spinner al volver.
      gcTime: 30 * 60 * 1000,
    },
  },
})
