import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useChatSocketConnected } from '../../realtime/useRealtime'
import { createLead, deleteLead, fetchChat, fetchChatsPage, fetchLeadByPhone, fetchMessageSearchPage, fetchPhoneConfig, fetchUnreadCount, markNoShow, mergeLead, updateLead } from './api'
import type { ChatFilters, LeadUpdateInput, MessagePageParam, PageParam } from './types'
import { kanbanKeys, leadKeys } from './keys'


/** Resuelve un único chat por su clave primaria, sin búsqueda ILIKE. */
export function useChat(chatId: string | null) {
  const connected = useChatSocketConnected()
  return useQuery({
    queryKey: leadKeys.detail(chatId),
    queryFn: () => fetchChat(chatId),
    enabled: !!chatId,
    staleTime: 30_000,
    refetchInterval: connected ? false : 60_000,
  })
}

/**
 * Lista de leads con scroll infinito, paginada por cursor.
 *
 * Con `contactsOnly`, una búsqueda trae solo los leads que matchean por sus
 * datos (la sección "Contactos" de la bandeja); los que matchean por un
 * mensaje salen de `useMessageSearch`. Sin él, la lista mezclada de siempre,
 * que usan los diálogos donde se elige un lead.
 */
export function useInfiniteChats(search: string = '', filters: ChatFilters, { contactsOnly = false } = {}) {
  const connected = useChatSocketConnected()
  const contactSearch = contactsOnly && !!search
  return useInfiniteQuery({
    queryKey: contactSearch ? leadKeys.contactSearch(search, filters) : leadKeys.list(search, filters),
    queryFn: ({ pageParam }) => fetchChatsPage(search, pageParam as PageParam, filters, contactSearch),
    initialPageParam: null as PageParam,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more || lastPage.items.length === 0) return undefined
      const last = lastPage.items[lastPage.items.length - 1]
      return { cursorTs: last.timestamp, cursorId: last.chat_id, cursorRank: last.search_rank ?? 2 }
    },
    staleTime: 30_000,
    // Respaldo por si el websocket se desconecta
    refetchInterval: connected ? false : 60_000,
    // Sin esto, los 3 reintentos automáticos de React Query absorben el
    // error antes de que isFetchNextPageError llegue a ser true, y el botón
    // "Reintentar" de la UI nunca se muestra.
    retry: false,
  })
}

/** Con menos letras el servidor no busca en los mensajes: matchearía media base. */
export const MIN_MESSAGE_SEARCH_CHARS = 2

/** Los mensajes que contienen la búsqueda, uno por fila y del más nuevo al
 * más viejo: la sección "Mensajes" del buscador de la bandeja. */
export function useMessageSearch(search: string, filters: ChatFilters) {
  const connected = useChatSocketConnected()
  return useInfiniteQuery({
    queryKey: leadKeys.messageSearch(search, filters),
    queryFn: ({ pageParam }) => fetchMessageSearchPage(search, pageParam as MessagePageParam, filters),
    initialPageParam: null as MessagePageParam,
    getNextPageParam: (lastPage) => {
      const last = lastPage.items[lastPage.items.length - 1]
      if (!lastPage.has_more || !last?.sent_at) return undefined
      return { cursorTs: last.sent_at, cursorId: last.message_id }
    },
    enabled: search.replace(/\s/g, '').length >= MIN_MESSAGE_SEARCH_CHARS,
    staleTime: 30_000,
    refetchInterval: connected ? false : 60_000,
    // Igual que la lista: sin esto los reintentos automáticos tapan el error
    // y "Reintentar" nunca se muestra.
    retry: false,
  })
}

/** Código de país por defecto para el form de leads (configurable en
 * Configuración). staleTime infinito: cambia una vez cada nunca. */
export function usePhoneConfig() {
  return useQuery({
    queryKey: leadKeys.phoneConfig,
    queryFn: fetchPhoneConfig,
    staleTime: Infinity,
  })
}

/** Busca si ya existe un lead con exactamente ese número (match por JID; la
 * búsqueda del servidor es por substring, el filtro fino se hace acá). */

export function useDuplicateLead(digits: string | null) {
  return useQuery({
    queryKey: leadKeys.duplicate(digits),
    queryFn: () => fetchLeadByPhone(digits ?? ''),
    enabled: !!digits && digits.length >= 8,
    staleTime: 15_000,
  })
}

/** Igual que `useDuplicateLead` pero bajo demanda (al tocar un contacto
 * compartido), compartiendo caché con él para no repetir la búsqueda. */
export function useFindLeadByPhone() {
  const queryClient = useQueryClient()
  return (digits: string) =>
    queryClient.fetchQuery({
      queryKey: leadKeys.duplicate(digits),
      queryFn: () => fetchLeadByPhone(digits),
      staleTime: 15_000,
    })
}

export function useCreateLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createLead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.unreadCount })
    },
  })
}

export function useUpdateLead(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: LeadUpdateInput) => updateLead(chatId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.activity(chatId) })
    },
  })
}

/** El vendedor confirma que el cliente no llegó a una cita agendada. */
export function useMarkNoShow(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => markNoShow(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.activity(chatId) })
    },
  })
}

/** Borra el lead entero (mensajes, tareas, notas incluidos). Irreversible. */
export function useDeleteLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteLead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.unreadCount })
      queryClient.invalidateQueries({ queryKey: kanbanKeys.all })
    },
  })
}

/** Fusiona `otherId` (se borra) dentro de `chatId` (se conserva su etapa e identidad). */
export function useMergeLead(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (otherId: string) => mergeLead(chatId, otherId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.unreadCount })
      queryClient.invalidateQueries({ queryKey: kanbanKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.activity(chatId) })
    },
  })
}

export function useUnreadCount(enabled = true) {
  const connected = useChatSocketConnected()
  return useQuery({
    queryKey: leadKeys.unreadCount,
    queryFn: fetchUnreadCount,
    staleTime: 10_000,
    refetchInterval: connected ? false : 60_000,
    // Un rol sin chats (el analista) no tiene nada que contar y el backend
    // le negaría el pedido.
    enabled,
  })
}
