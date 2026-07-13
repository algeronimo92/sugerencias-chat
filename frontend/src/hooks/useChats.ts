import { useEffect, useRef } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import type { Chat, ChatFilters, LeadInput, LeadUpdateInput } from '../types'
import { parseContent } from '../utils/message'

interface ChatsPage {
  items: Chat[]
  has_more: boolean
}

/** Cursor de keyset: última fila de la página anterior (mismo orden que la consulta del backend). */
type PageParam = { cursorTs: string | null; cursorId: string } | null

async function fetchChatsPage(search: string, pageParam: PageParam, filters?: ChatFilters): Promise<ChatsPage> {
  const params: Record<string, string> = {}
  if (search) params.search = search
  if (filters?.unreadOnly) params.unread_only = 'true'
  if (filters?.stages.length) params.stages = filters.stages.join(',')
  if (filters?.tagIds.length) params.tag_ids = filters.tagIds.join(',')
  if (filters?.tagIds.length) params.tag_mode = filters.tagMode
  if (filters?.service.trim()) params.service = filters.service.trim()
  if (filters?.seller.trim()) params.seller = filters.seller.trim()
  if (filters?.origin.trim()) params.origin = filters.origin.trim()
  if (filters?.lastSender) params.last_sender = filters.lastSender
  if (filters?.inactiveDays) params.inactive_days = String(filters.inactiveDays)
  if (pageParam) {
    params.cursor_id = pageParam.cursorId
    if (pageParam.cursorTs) params.cursor_ts = pageParam.cursorTs
  }
  const { data } = await client.get<ChatsPage>('/api/chats', { params })
  return data
}

function chatsSocketUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
  return `${base.replace(/^http/, 'ws')}/ws/chats`
}

const RECONNECT_DELAY_MS = 3_000

interface LatestMessage {
  message_id: string
  chat_id: string
  sender: string
  content: string | null
  name: string | null
}

type NotifyFn = (title: string, body: string, onClick: () => void) => void

/** Escucha el websocket del backend y refresca chats/mensajes en cuanto hay
 * novedades. También dispara una notificación cuando el mensaje nuevo es de
 * un cliente y la aplicación está en segundo plano. Llamar una sola vez.
 * `activeChatId` se mantiene como parámetro por compatibilidad con las vistas;
 * useNotifications determina si la aplicación está realmente visible.
 * `notify` se recibe por parámetro (en vez de llamar a useNotifications acá
 * adentro) para que el estado de permiso de notificaciones quede en una
 * única instancia, compartida con el botón del header que lo controla. */
export function useChatUpdates(activeChatId: string | null = null, notify: NotifyFn = () => {}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const lastNotifiedMessageIdRef = useRef<string | null>(null)

  // El socket se conecta una sola vez (no queremos reconectar cada vez que
  // cambia el chat abierto o el permiso de notificaciones).
  void activeChatId
  const notifyRef = useRef(notify)
  notifyRef.current = notify

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    function connect() {
      socket = new WebSocket(chatsSocketUrl())

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload.type === 'chats_updated') {
            queryClient.invalidateQueries({ queryKey: ['chats'] })
            queryClient.invalidateQueries({ queryKey: ['kanban'] })
            queryClient.invalidateQueries({ queryKey: ['unread-count'] })
            queryClient.invalidateQueries({ queryKey: ['lead-activity'] })
            // También refresca el hilo de mensajes abierto, si lo hay
            queryClient.invalidateQueries({ queryKey: ['messages'] })

            const latest = payload.latest_message as LatestMessage | undefined
            if (
              latest &&
              latest.sender === 'cliente' &&
              latest.message_id !== lastNotifiedMessageIdRef.current
            ) {
              // El webhook de n8n y el watcher de respaldo pueden anunciar el
              // mismo insert. Se deduplica para no incrementar dos veces el badge.
              lastNotifiedMessageIdRef.current = latest.message_id
              const preview = parseContent(latest.content)
              notifyRef.current(latest.name || 'Nuevo mensaje', preview.text || preview.label || 'Mensaje nuevo', () => {
                navigate(`/chat/${latest.chat_id}`)
              })
            }
          }
        } catch {
          // Ignora payloads que no sean JSON válido
        }
      }

      socket.onclose = () => {
        if (!stopped) {
          reconnectTimeout = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }
    }

    connect()

    return () => {
      stopped = true
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      socket?.close()
    }
  }, [queryClient, navigate])
}

/** Resuelve un único chat (por id vía el parámetro search) fuera de la lista paginada. */
export function useChats(search: string = '', options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['chats', 'lookup', search],
    queryFn: async () => (await fetchChatsPage(search, null)).items,
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
    // Respaldo por si el websocket se desconecta
    refetchInterval: 20_000,
  })
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['unread-count'],
    queryFn: async () => (await client.get<{ count: number }>('/api/chats/unread-count')).data.count,
    staleTime: 10_000,
    refetchInterval: 20_000,
  })
}

/** Lista de leads con scroll infinito, paginada por cursor. */
export function useInfiniteChats(search: string = '', filters: ChatFilters) {
  return useInfiniteQuery({
    queryKey: ['chats', 'list', search, filters],
    queryFn: ({ pageParam }) => fetchChatsPage(search, pageParam as PageParam, filters),
    initialPageParam: null as PageParam,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more || lastPage.items.length === 0) return undefined
      const last = lastPage.items[lastPage.items.length - 1]
      return { cursorTs: last.timestamp, cursorId: last.chat_id }
    },
    staleTime: 30_000,
    // Respaldo por si el websocket se desconecta
    refetchInterval: 20_000,
    // Sin esto, los 3 reintentos automáticos de React Query absorben el
    // error antes de que isFetchNextPageError llegue a ser true, y el botón
    // "Reintentar" de la UI nunca se muestra.
    retry: false,
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

async function markChatRead(chatId: string): Promise<void> {
  await client.post(`/api/chats/${encodeURIComponent(chatId)}/read`)
}

/** Marca un chat como visto — resetea su unread_count. Se llama al abrirlo. */
export function useMarkChatRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markChatRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['unread-count'] })
    },
  })
}
