import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import client from '../api/client'
import type { Chat, ChatFilters, LeadInput, LeadUpdateInput } from '../types'
import { useChatSocketConnected } from './useRealtime'

interface ChatsPage {
  items: Chat[]
  has_more: boolean
}

/** Cursor de keyset: última fila de la página anterior (mismo orden que la consulta del backend).
 * cursorRank indica en qué sección del orden con búsqueda quedó esa fila
 * (2 = matches por nombre, 1 = por campos CRM, 0 = por mensaje). */
type PageParam = { cursorTs: string | null; cursorId: string; cursorRank?: number } | null

async function fetchChatsPage(search: string, pageParam: PageParam, filters?: ChatFilters): Promise<ChatsPage> {
  const params: Record<string, string> = {}
  if (search) params.search = search
  if (filters?.unreadOnly) params.unread_only = 'true'
  if (filters?.stages.length) params.stages = filters.stages.join(',')
  if (filters?.tagIds.length) params.tag_ids = filters.tagIds.join(',')
  if (filters?.tagIds.length) params.tag_mode = filters.tagMode
  if (filters?.service.trim()) params.service = filters.service.trim()
  if (filters?.sellerId) params.seller_id = String(filters.sellerId)
  if (filters?.origin.trim()) params.origin = filters.origin.trim()
  if (filters?.lastSender) params.last_sender = filters.lastSender
  if (filters?.inactiveDays) params.inactive_days = String(filters.inactiveDays)
  if (filters?.waitingTime) params.waiting_time = filters.waitingTime
  if (filters?.automationPaused) params.automation_paused = 'true'
  if (pageParam) {
    params.cursor_id = String(pageParam.cursorId)
    if (pageParam.cursorTs) params.cursor_ts = pageParam.cursorTs
    if (search) params.cursor_rank = String(pageParam.cursorRank ?? 2)
  }
  const { data } = await client.get<ChatsPage>('/api/chats', { params })
  return data
}

/** Resuelve un único chat por su clave primaria, sin búsqueda ILIKE. */
export function useChat(chatId: string | null) {
  const connected = useChatSocketConnected()
  return useQuery({
    queryKey: ['chat', chatId],
    queryFn: async () => (await client.get<Chat>(`/api/chats/${encodeURIComponent(chatId as string)}`)).data,
    enabled: !!chatId,
    staleTime: 30_000,
    refetchInterval: connected ? false : 60_000,
  })
}

export function useUnreadCount() {
  const connected = useChatSocketConnected()
  return useQuery({
    queryKey: ['unread-count'],
    queryFn: async () => (await client.get<{ count: number }>('/api/chats/unread-count')).data.count,
    staleTime: 10_000,
    refetchInterval: connected ? false : 60_000,
  })
}

/** Lista de leads con scroll infinito, paginada por cursor. */
export function useInfiniteChats(search: string = '', filters: ChatFilters) {
  const connected = useChatSocketConnected()
  return useInfiniteQuery({
    queryKey: ['chats', 'list', search, filters],
    queryFn: ({ pageParam }) => fetchChatsPage(search, pageParam as PageParam, filters),
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

/** Código de país por defecto para el form de leads (configurable en
 * Configuración). staleTime infinito: cambia una vez cada nunca. */
export function usePhoneConfig() {
  return useQuery({
    queryKey: ['phone-config'],
    queryFn: async () =>
      (await client.get<{ default_country_code: string }>('/api/chats/phone-config')).data,
    staleTime: Infinity,
  })
}

/** Busca si ya existe un lead con exactamente ese número (match por JID; la
 * búsqueda del servidor es por substring, el filtro fino se hace acá). */
async function fetchLeadByPhone(digits: string): Promise<Chat | null> {
  const { data } = await client.get<ChatsPage>('/api/chats', { params: { search: digits } })
  return data.items.find((chat) => (chat.phone ?? '').replace(/\D/g, '').endsWith(digits)) ?? null
}

export function useDuplicateLead(digits: string | null) {
  return useQuery({
    queryKey: ['duplicate-lead', digits],
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
      queryKey: ['duplicate-lead', digits],
      queryFn: () => fetchLeadByPhone(digits),
      staleTime: 15_000,
    })
}

async function createLead(payload: LeadInput): Promise<Chat> {
  const { data } = await client.post<Chat>('/api/chats', payload)
  return data
}

export function useCreateLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createLead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['unread-count'] })
    },
  })
}

async function updateLead(chatId: string, payload: LeadUpdateInput): Promise<Chat> {
  const { data } = await client.patch<Chat>(`/api/chats/${encodeURIComponent(chatId)}`, payload)
  return data
}

export function useUpdateLead(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: LeadUpdateInput) => updateLead(chatId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}

async function markNoShow(chatId: string): Promise<Chat> {
  const { data } = await client.post<Chat>(`/api/chats/${encodeURIComponent(chatId)}/no-show`)
  return data
}

/** El vendedor confirma que el cliente no llegó a una cita agendada. */
export function useMarkNoShow(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => markNoShow(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}

async function deleteLead(chatId: string): Promise<void> {
  await client.delete(`/api/chats/${encodeURIComponent(chatId)}`)
}

/** Borra el lead entero (mensajes, tareas, notas incluidos). Irreversible. */
export function useDeleteLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteLead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['unread-count'] })
      queryClient.invalidateQueries({ queryKey: ['kanban'] })
    },
  })
}

async function mergeLead(chatId: string, otherId: string): Promise<Chat> {
  const { data } = await client.post<Chat>(`/api/chats/${encodeURIComponent(chatId)}/merge`, { other_id: otherId })
  return data
}

/** Fusiona `otherId` (se borra) dentro de `chatId` (se conserva su etapa e identidad). */
export function useMergeLead(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (otherId: string) => mergeLead(chatId, otherId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['unread-count'] })
      queryClient.invalidateQueries({ queryKey: ['kanban'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}

async function markChatRead(chatId: string): Promise<void> {
  await client.post(`/api/chats/${encodeURIComponent(chatId)}/read`)
}

/** Marca un chat como visto — resetea su unread_count. Se llama al abrirlo.
 *
 * Parchea la caché en vez de invalidar ['chats']: invalidar reordena la
 * lista completa (por actividad/no-leídos) mientras en móvil sigue montada
 * pero oculta detrás del chat abierto. Como esto se dispara en casi cada
 * entrada a un lead, el usuario volvía a la lista con el scroll "saltado"
 * a leads distintos de los que había dejado en esa posición. */
export function useMarkChatRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markChatRead,
    onSuccess: (_data, chatId) => {
      queryClient.setQueriesData<InfiniteData<ChatsPage>>(
        { queryKey: ['chats', 'list'] },
        (current) => {
          if (!current) return current
          return {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                item.chat_id === chatId ? { ...item, unread_count: 0 } : item
              ),
            })),
          }
        }
      )
      queryClient.invalidateQueries({ queryKey: ['unread-count'] })
    },
  })
}

async function markChatUnread(chatId: string): Promise<void> {
  await client.post(`/api/chats/${encodeURIComponent(chatId)}/unread`)
}

/** Marca manualmente un chat como pendiente sin cambiar los recibos de WhatsApp. */
export function useMarkChatUnread() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markChatUnread,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['unread-count'] })
    },
  })
}
