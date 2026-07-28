import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import client from '../api/client'
import type { HistoryPage } from '../types'

async function fetchHistory(chatId: string, page: number | null, beforeTs: string | null): Promise<HistoryPage> {
  const params: Record<string, string | number> = {}
  // Sin `page`, el backend estima por dónde empezar según cuántos mensajes
  // del chat ya están registrados.
  if (page != null) params.page = page
  if (beforeTs) params.before_ts = beforeTs
  const { data } = await client.get<HistoryPage>(`/api/chats/${encodeURIComponent(chatId)}/history`, { params })
  return data
}

/**
 * Historial de WhatsApp anterior al primer mensaje registrado en la base.
 *
 * No se cachea con vencimiento ni se refresca solo: es historial cerrado y
 * cada consulta cuesta varias llamadas a Evolution. Se activa a mano, cuando
 * el usuario pide ver lo anterior al registro propio.
 *
 * `beforeTs` es la fecha del mensaje más viejo que hay en la base. Queda
 * fuera de la queryKey a propósito: la consulta solo se habilita con la base
 * ya agotada, así que el límite no se mueve mientras se pagina.
 */
export function useEvolutionHistory(chatId: string | null, beforeTs: string | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['evolution-history', chatId],
    queryFn: ({ pageParam }) => fetchHistory(chatId as string, pageParam, beforeTs),
    enabled: !!chatId && enabled,
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.next_page ?? undefined : undefined),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })
}

/** Si la instancia de Evolution está configurada. Cuando no lo está no se
 * ofrece traer el historial, en vez de mostrar un botón que siempre falla. */
export function useEvolutionHistoryAvailability() {
  return useQuery({
    queryKey: ['evolution-history-availability'],
    queryFn: async () => {
      const { data } = await client.get<{ available: boolean }>('/api/chats/history/availability')
      return data
    },
    staleTime: Infinity,
    retry: false,
  })
}
