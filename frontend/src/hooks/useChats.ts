import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import type { Chat, ChatFilters, LeadInput, LeadUpdateInput, Message, MessageStatus } from '../types'
import type { NotificationOptions } from './useNotifications'
import { parseContent } from '../utils/message'
import { NotificationType } from '../domain/automationCatalog'

interface ChatsPage {
  items: Chat[]
  has_more: boolean
}

interface CachedMessagePage {
  items: Message[]
  has_more: boolean
}

interface MessageStatusUpdate {
  id: number
  status: MessageStatus
}

function applyMessageStatuses(
  queryClient: QueryClient,
  chatId: string,
  updates: MessageStatusUpdate[],
) {
  if (!updates.length) return
  const byId = new Map(updates.map(update => [update.id, update.status]))
  queryClient.setQueryData<InfiniteData<CachedMessagePage>>(['messages', chatId], current => {
    if (!current) return current
    return {
      ...current,
      pages: current.pages.map(page => ({
        ...page,
        items: page.items.map(message => byId.has(message.id)
          ? { ...message, status: byId.get(message.id) ?? message.status }
          : message),
      })),
    }
  })
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
  if (pageParam) {
    params.cursor_id = pageParam.cursorId
    if (pageParam.cursorTs) params.cursor_ts = pageParam.cursorTs
    if (search) params.cursor_rank = String(pageParam.cursorRank ?? 2)
  }
  const { data } = await client.get<ChatsPage>('/api/chats', { params })
  return data
}

function chatsSocketUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
  return `${base.replace(/^http/, 'ws')}/ws/chats`
}

const RECONNECT_DELAY_MS = 3_000
const socketListeners = new Set<() => void>()
let socketConnected = false

function setSocketConnected(value: boolean) {
  if (socketConnected === value) return
  socketConnected = value
  socketListeners.forEach(listener => listener())
}

export function useChatSocketConnected() {
  return useSyncExternalStore(
    listener => {
      socketListeners.add(listener)
      return () => {
        socketListeners.delete(listener)
      }
    },
    () => socketConnected,
    () => false,
  )
}

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
      socket.onopen = () => setSocketConnected(true)

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload.type === 'tasks_updated') {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            queryClient.invalidateQueries({ queryKey: ['dashboard'] })
          }
          if (payload.type === 'scheduled_messages_updated') {
            const scheduledChatId = typeof payload.chat_id === 'string' ? payload.chat_id : undefined
            queryClient.invalidateQueries({
              queryKey: scheduledChatId ? ['scheduled-messages', scheduledChatId] : ['scheduled-messages'],
            })
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
            const latest = payload.latest_message as LatestMessage | undefined
            const changedChatId = typeof payload.chat_id === 'string' ? payload.chat_id : latest?.chat_id
            const reason = typeof payload.reason === 'string' ? payload.reason : 'unknown'
            const messageStatuses: MessageStatusUpdate[] = Array.isArray(payload.message_statuses)
              ? payload.message_statuses.flatMap((item: unknown) => {
                  if (!item || typeof item !== 'object') return []
                  const candidate = item as { id?: unknown; status?: unknown }
                  if (typeof candidate.id !== 'number' || typeof candidate.status !== 'string') return []
                  return [{ id: candidate.id, status: candidate.status as MessageStatus }]
                })
              : []

            queryClient.invalidateQueries({ queryKey: ['chats'] })
            queryClient.invalidateQueries({ queryKey: ['unread-count'] })
            if (changedChatId) {
              applyMessageStatuses(queryClient, changedChatId, messageStatuses)
              queryClient.invalidateQueries({ queryKey: ['chat', changedChatId] })
              if (reason !== 'message_status' && reason !== 'read') {
                queryClient.invalidateQueries({ queryKey: ['lead-activity', changedChatId] })
              }
              if (queryClient.isMutating({ mutationKey: ['send-message', changedChatId] }) === 0) {
                queryClient.invalidateQueries({ queryKey: ['messages', changedChatId] })
              }
              if (reason === 'inbound_message') {
                queryClient.invalidateQueries({ queryKey: ['customer-service-window', changedChatId] })
              }
            } else {
              queryClient.invalidateQueries({ queryKey: ['messages'] })
              queryClient.invalidateQueries({ queryKey: ['lead-activity'] })
              queryClient.invalidateQueries({ queryKey: ['customer-service-window'] })
            }
            if (['lead_created', 'lead_updated', 'stage_changed', 'tag_changed'].includes(reason) || !changedChatId) {
              queryClient.invalidateQueries({ queryKey: ['kanban'] })
            }
            if (['inbound_message', 'outbound_message', 'lead_created', 'stage_changed'].includes(reason)) {
              queryClient.invalidateQueries({ queryKey: ['dashboard'] })
            }

            if (latest && latest.sender === 'cliente') {
              // Un mensaje nuevo del cliente deja desactualizada la sugerencia
              // guardada de ese chat. Invalidar acá NO regenera nada: la query
              // ['suggestions', chatId] es una lectura barata (GET) y su
              // refetch solo trae `stale: true`, con lo que el panel muestra
              // el aviso "El cliente volvió a escribir" y deja la regeneración
              // (que sí cuesta IA) en manos del vendedor.
              queryClient.invalidateQueries({ queryKey: ['suggestions', latest.chat_id] })
            }
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
        setSocketConnected(false)
        if (!stopped) {
          reconnectTimeout = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }
    }

    connect()

    return () => {
      stopped = true
      setSocketConnected(false)
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      socket?.close()
    }
  }, [queryClient, navigate])
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
export function useDuplicateLead(digits: string | null) {
  return useQuery({
    queryKey: ['duplicate-lead', digits],
    queryFn: async () => {
      const { data } = await client.get<ChatsPage>('/api/chats', { params: { search: digits } })
      return data.items.find((chat) => chat.chat_id === `${digits}@s.whatsapp.net`) ?? null
    },
    enabled: !!digits && digits.length >= 8,
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
    onSuccess: (data) => {
      if (data.chat_id !== chatId) {
        // Cambió el número (re-key del JID): el lead ahora vive bajo otro id
        // y cualquier cache del viejo (mensajes, ventana, notas…) quedó huérfana.
        queryClient.invalidateQueries()
        return
      }
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
