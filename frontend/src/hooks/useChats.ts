import { useEffect, useRef } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import type { Chat, ChatFilters, LeadInput, LeadUpdateInput } from '../types'
import type { NotificationOptions } from './useNotifications'
import { parseContent } from '../utils/message'
import { NotificationType } from '../domain/automationCatalog'

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
  if (filters?.sellerId) params.seller_id = String(filters.sellerId)
  if (filters?.origin.trim()) params.origin = filters.origin.trim()
  if (filters?.lastSender) params.last_sender = filters.lastSender
  if (filters?.inactiveDays) params.inactive_days = String(filters.inactiveDays)
  if (filters?.waitingTime) params.waiting_time = filters.waitingTime
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

type NotifyFn = (title: string, body: string, onClick: () => void, options?: NotificationOptions) => void
export interface InternalMentionAlert { notificationId: number; leadId: string; authorName: string; content: string }
type InternalMentionFn = (alert: InternalMentionAlert) => void

/** Escucha el websocket del backend y refresca chats/mensajes en cuanto hay
 * novedades. También dispara una notificación cuando el mensaje nuevo es de
 * un cliente y la aplicación está en segundo plano. Llamar una sola vez.
 * `activeChatId` se mantiene como parámetro por compatibilidad con las vistas;
 * useNotifications determina si la aplicación está realmente visible.
 * `notify` se recibe por parámetro (en vez de llamar a useNotifications acá
 * adentro) para que el estado de permiso de notificaciones quede en una
 * única instancia, compartida con el botón del header que lo controla. */
export function useChatUpdates(
  activeChatId: string | null = null,
  notify: NotifyFn = () => {},
  onInternalMention: InternalMentionFn = () => {},
) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const lastNotifiedMessageIdRef = useRef<string | null>(null)

  // El socket se conecta una sola vez (no queremos reconectar cada vez que
  // cambia el chat abierto o el permiso de notificaciones).
  void activeChatId
  const notifyRef = useRef(notify)
  notifyRef.current = notify
  const internalMentionRef = useRef(onInternalMention)
  internalMentionRef.current = onInternalMention

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    function connect() {
      socket = new WebSocket(chatsSocketUrl())

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload.type === 'tasks_updated') {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            queryClient.invalidateQueries({ queryKey: ['dashboard'] })
          }
          if (payload.type === 'templates_updated') {
            queryClient.invalidateQueries({ queryKey: ['templates'] })
          }
          if (payload.type === 'media_library_updated') {
            queryClient.invalidateQueries({ queryKey: ['media-library'] })
          }
          if (payload.type === 'internal_notes_updated') {
            queryClient.invalidateQueries({ queryKey: ['internal-notes', payload.lead_id] })
            queryClient.invalidateQueries({ queryKey: ['lead-activity', payload.lead_id] })
          }
          if (payload.type === 'notifications_updated') {
            queryClient.invalidateQueries({ queryKey: ['notifications'] })
          }
          if (payload.type === 'automations_updated') {
            queryClient.invalidateQueries({ queryKey: ['automations'] })
            queryClient.invalidateQueries({ queryKey: ['automation-executions'] })
          }
          if (payload.type === 'notification_created') {
            const notification = payload.notification as {
              id: number
              notification_type: string
              title: string
              body: string
              lead_id: string | null
              metadata: { author_name?: string } | null
            }
            queryClient.invalidateQueries({ queryKey: ['notifications'] })
            notifyRef.current(
              notification.title,
              notification.body.length > 140 ? `${notification.body.slice(0, 137)}...` : notification.body,
              () => { if (notification.lead_id) navigate(`/chat/${notification.lead_id}`) },
              { force: true, tag: `notification-${notification.id}` },
            )
            if (notification.notification_type === NotificationType.InternalNoteMention && notification.lead_id) {
              internalMentionRef.current({
                notificationId: notification.id,
                leadId: notification.lead_id,
                authorName: notification.metadata?.author_name ?? 'Un usuario',
                content: notification.body,
              })
            }
          }
          if (payload.type === 'internal_note_mention') {
            const note = payload.note as { id: number; lead_id: string; content: string }
            const mentionedBy = payload.mentioned_by as { name: string }
            queryClient.invalidateQueries({ queryKey: ['internal-notes', note.lead_id] })
            notifyRef.current(
              `${mentionedBy.name} te mencionó en una nota`,
              note.content.length > 140 ? `${note.content.slice(0, 137)}...` : note.content,
              () => navigate(`/chat/${note.lead_id}`),
              { force: true, tag: `internal-note-${note.id}` },
            )
            internalMentionRef.current({
              notificationId: note.id,
              leadId: note.lead_id,
              authorName: mentionedBy.name,
              content: note.content,
            })
          }
          if (payload.type === 'task_reminder') {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            const task = payload.task as { task_id: number; lead_id: string; lead_name: string | null; title: string }
            notifyRef.current(
              `Recordatorio: ${task.lead_name || 'Lead'}`,
              task.title,
              () => navigate(`/chat/${task.lead_id}`),
              { force: true, tag: `task-reminder-${task.task_id}` }
            )
          }
          if (payload.type === 'chats_updated') {
            queryClient.invalidateQueries({ queryKey: ['dashboard'] })
            queryClient.invalidateQueries({ queryKey: ['chats'] })
            queryClient.invalidateQueries({ queryKey: ['kanban'] })
            queryClient.invalidateQueries({ queryKey: ['unread-count'] })
            queryClient.invalidateQueries({ queryKey: ['lead-activity'] })
            // También refresca el hilo de mensajes abierto, si lo hay
            queryClient.invalidateQueries({ queryKey: ['messages'] })
            queryClient.invalidateQueries({ queryKey: ['customer-service-window'] })

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
