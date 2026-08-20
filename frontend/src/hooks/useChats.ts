import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import type { Chat, ChatFilters, JsonValue, LeadInput, LeadUpdateInput, Message, MessageStatus, MessageType } from '../types'
import type { NotificationOptions } from './useNotifications'
import { isJsonObject, parseContent } from '../utils/message'
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

interface MessageStatusCandidate {
  id?: number
  status?: string
}

const MESSAGE_STATUS_VALUES: ReadonlySet<string> = new Set([
  'PENDING', 'FAILED', 'DISCARDED', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED',
])

const MESSAGE_TYPE_VALUES: ReadonlySet<string> = new Set([
  'text', 'image', 'video', 'ptv', 'audio', 'document', 'location', 'sticker',
  'contact', 'poll', 'reaction', 'interactive', 'template', 'order', 'product',
  'payment', 'view_once', 'unsupported',
])

function isMessageStatus(value: string): value is Exclude<MessageStatus, null> {
  return MESSAGE_STATUS_VALUES.has(value)
}

function isMessageType(value: string): value is MessageType {
  return MESSAGE_TYPE_VALUES.has(value)
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
  if (filters?.automationPaused) params.automation_paused = 'true'
  if (pageParam) {
    params.cursor_id = String(pageParam.cursorId)
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
// Heartbeat: se manda un ping cada PING_INTERVAL_MS y, si no llega NINGÚN dato
// (ni el pong del server) en ACTIVITY_TIMEOUT_MS, el watchdog fuerza reconectar.
// Detecta las conexiones half-open que no disparan onclose.
const PING_INTERVAL_MS = 25_000
const WATCHDOG_INTERVAL_MS = 10_000
const ACTIVITY_TIMEOUT_MS = 40_000
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
  message_type?: MessageType | null
  name: string | null
}

interface CreatedNotification {
  id: number
  notification_type: string
  title: string
  body: string
  lead_id: string | null
  metadata: { author_name?: string; issue_report_id?: number } | null
}

type ChatSocketEvent =
  | { type: 'tasks_updated' | 'templates_updated' | 'media_library_updated' | 'notifications_updated' | 'automations_updated' | 'issue_reports_updated' }
  | { type: 'scheduled_messages_updated'; chat_id?: string }
  | { type: 'internal_notes_updated'; lead_id: string }
  | { type: 'notification_created'; notification: CreatedNotification }
  | { type: 'internal_note_mention'; note: { id: number; lead_id: string; content: string }; mentioned_by: { name: string } }
  | { type: 'task_reminder'; task: { task_id: number; lead_id: string; lead_name: string | null; title: string } }
  | {
      type: 'chats_updated'
      chat_id?: string
      reason?: string
      latest_message?: LatestMessage
      message_statuses?: MessageStatusCandidate[]
    }

function isNullableString(value: JsonValue | undefined): value is string | null {
  return value === null || typeof value === 'string'
}

function parseChatSocketEvent(data: string): ChatSocketEvent | null {
  const parsed: JsonValue = JSON.parse(data)
  if (!isJsonObject(parsed) || typeof parsed.type !== 'string') return null

  switch (parsed.type) {
    case 'tasks_updated':
    case 'templates_updated':
    case 'media_library_updated':
    case 'notifications_updated':
    case 'automations_updated':
    case 'issue_reports_updated':
      return { type: parsed.type }
    case 'scheduled_messages_updated':
      return {
        type: parsed.type,
        chat_id: typeof parsed.chat_id === 'string' ? parsed.chat_id : undefined,
      }
    case 'internal_notes_updated':
      return typeof parsed.lead_id === 'string' ? { type: parsed.type, lead_id: parsed.lead_id } : null
    case 'notification_created': {
      const notification = parsed.notification
      if (
        !isJsonObject(notification)
        || typeof notification.id !== 'number'
        || typeof notification.notification_type !== 'string'
        || typeof notification.title !== 'string'
        || typeof notification.body !== 'string'
        || !isNullableString(notification.lead_id)
      ) return null
      const metadata = isJsonObject(notification.metadata)
        ? {
            author_name: typeof notification.metadata.author_name === 'string' ? notification.metadata.author_name : undefined,
            issue_report_id: typeof notification.metadata.issue_report_id === 'number' ? notification.metadata.issue_report_id : undefined,
          }
        : null
      return {
        type: parsed.type,
        notification: {
          id: notification.id,
          notification_type: notification.notification_type,
          title: notification.title,
          body: notification.body,
          lead_id: notification.lead_id,
          metadata,
        },
      }
    }
    case 'internal_note_mention': {
      const note = parsed.note
      const mentionedBy = parsed.mentioned_by
      if (
        !isJsonObject(note)
        || typeof note.id !== 'number'
        || typeof note.lead_id !== 'string'
        || typeof note.content !== 'string'
        || !isJsonObject(mentionedBy)
        || typeof mentionedBy.name !== 'string'
      ) return null
      return {
        type: parsed.type,
        note: { id: note.id, lead_id: note.lead_id, content: note.content },
        mentioned_by: { name: mentionedBy.name },
      }
    }
    case 'task_reminder': {
      const task = parsed.task
      if (
        !isJsonObject(task)
        || typeof task.task_id !== 'number'
        || typeof task.lead_id !== 'string'
        || !isNullableString(task.lead_name)
        || typeof task.title !== 'string'
      ) return null
      return {
        type: parsed.type,
        task: { task_id: task.task_id, lead_id: task.lead_id, lead_name: task.lead_name, title: task.title },
      }
    }
    case 'chats_updated': {
      const rawLatest = parsed.latest_message
      const latest = isJsonObject(rawLatest)
        && typeof rawLatest.message_id === 'string'
        && typeof rawLatest.chat_id === 'string'
        && typeof rawLatest.sender === 'string'
        && isNullableString(rawLatest.content)
        && isNullableString(rawLatest.name)
        ? {
            message_id: rawLatest.message_id,
            chat_id: rawLatest.chat_id,
            sender: rawLatest.sender,
            content: rawLatest.content,
            message_type: typeof rawLatest.message_type === 'string' && isMessageType(rawLatest.message_type)
              ? rawLatest.message_type
              : null,
            name: rawLatest.name,
          }
        : undefined
      const messageStatuses = Array.isArray(parsed.message_statuses)
        ? parsed.message_statuses.flatMap(item => isJsonObject(item)
          && typeof item.id === 'number'
          && typeof item.status === 'string'
          ? [{ id: item.id, status: item.status }]
          : [])
        : undefined
      return {
        type: parsed.type,
        chat_id: typeof parsed.chat_id === 'string' ? parsed.chat_id : undefined,
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        latest_message: latest,
        message_statuses: messageStatuses,
      }
    }
    default:
      return null
  }
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
  const internalMentionRef = useRef(onInternalMention)

  // Las referencias se actualizan después del render, no durante. React puede
  // repetir o descartar trabajo de render, así que escribir ahí filtra valores
  // desde una UI que quizá nunca se confirmó. El handler del socket lee
  // `.current` cuando llega un mensaje —siempre después del commit—, de modo
  // que sigue viendo el callback vigente sin reconectar el socket.
  useEffect(() => {
    notifyRef.current = notify
    internalMentionRef.current = onInternalMention
  })

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let pingInterval: ReturnType<typeof setInterval> | null = null
    let watchdogInterval: ReturnType<typeof setInterval> | null = null
    let lastActivityAt = Date.now()
    let stopped = false

    function clearHeartbeat() {
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null }
      if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null }
    }

    // Al (re)conectar se resincroniza todo lo que depende del tiempo real: los
    // broadcasts ocurridos mientras el socket estuvo caído se perdieron (se
    // enviaron a un socket muerto), así que hay que refetchear para no quedar
    // desactualizado hasta el próximo broadcast o un F5.
    function resync() {
      for (const key of [['chats'], ['unread-count'], ['kanban'], ['dashboard'], ['notifications'], ['messages'], ['chat'], ['issue-reports']]) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    }

    function connect() {
      socket = new WebSocket(chatsSocketUrl())

      socket.onopen = () => {
        setSocketConnected(true)
        lastActivityAt = Date.now()
        resync()
        // Sin heartbeat, una conexión half-open (tras dormir la laptop, cambiar
        // de red o un timeout de proxy) queda "abierta" para el navegador pero
        // muerta —onclose nunca dispara— y la pantalla se congela. El ping le da
        // señal de vida; el watchdog fuerza reconectar si dejó de llegar data.
        pingInterval = setInterval(() => {
          try { socket?.send(JSON.stringify({ type: 'ping' })) } catch { /* lo cierra el watchdog */ }
        }, PING_INTERVAL_MS)
        watchdogInterval = setInterval(() => {
          if (Date.now() - lastActivityAt > ACTIVITY_TIMEOUT_MS) socket?.close()
        }, WATCHDOG_INTERVAL_MS)
      }

      socket.onmessage = (event) => {
        lastActivityAt = Date.now()
        try {
          const payload = parseChatSocketEvent(event.data)
          if (!payload) return
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
          if (payload.type === 'issue_reports_updated') {
            queryClient.invalidateQueries({ queryKey: ['issue-reports'] })
          }
          if (payload.type === 'notification_created') {
            const notification = payload.notification
            queryClient.invalidateQueries({ queryKey: ['notifications'] })
            notifyRef.current(
              notification.title,
              notification.body.length > 140 ? `${notification.body.slice(0, 137)}...` : notification.body,
              () => {
                if (notification.notification_type === NotificationType.IssueReport) {
                  navigate(notification.metadata?.issue_report_id ? `/reports?report=${notification.metadata.issue_report_id}` : '/reports')
                }
                else if (notification.lead_id) navigate(`/chat/${notification.lead_id}`)
              },
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
            const note = payload.note
            const mentionedBy = payload.mentioned_by
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
            const task = payload.task
            notifyRef.current(
              `Recordatorio: ${task.lead_name || 'Lead'}`,
              task.title,
              () => navigate(`/chat/${task.lead_id}`),
              { force: true, tag: `task-reminder-${task.task_id}` }
            )
          }
          if (payload.type === 'chats_updated') {
            const latest = payload.latest_message
            const changedChatId = typeof payload.chat_id === 'string' ? payload.chat_id : latest?.chat_id
            const reason = typeof payload.reason === 'string' ? payload.reason : 'unknown'
            const messageStatuses: MessageStatusUpdate[] = Array.isArray(payload.message_statuses)
              ? payload.message_statuses.flatMap((candidate) => {
                  if (typeof candidate.id !== 'number' || typeof candidate.status !== 'string' || !isMessageStatus(candidate.status)) return []
                  return [{ id: candidate.id, status: candidate.status }]
                })
              : []

            // Un cambio de estado de entrega (SERVER_ACK/DELIVERY_ACK/READ)
            // solo afecta a la burbuja: `Chat` no lleva estado y ChatList no
            // lo pinta. applyMessageStatuses ya parchea la caché de mensajes,
            // así que refetchear lista + detalle + historial completo era
            // tráfico puro. Cada acuse de WhatsApp disparaba tres GET, y un
            // envío genera varios acuses seguidos.
            const isStatusOnly = reason === 'message_status'

            if (!isStatusOnly) {
              queryClient.invalidateQueries({ queryKey: ['chats'] })
              queryClient.invalidateQueries({ queryKey: ['unread-count'] })
            }
            if (changedChatId) {
              applyMessageStatuses(queryClient, changedChatId, messageStatuses)
              if (!isStatusOnly) {
                queryClient.invalidateQueries({ queryKey: ['chat', changedChatId] })
              }
              if (reason !== 'message_status' && reason !== 'read') {
                queryClient.invalidateQueries({ queryKey: ['lead-activity', changedChatId] })
              }
              if (!isStatusOnly && queryClient.isMutating({ mutationKey: ['send-message', changedChatId] }) === 0) {
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
              const preview = parseContent({ content: latest.content, message_type: latest.message_type })
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
        clearHeartbeat()
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
      clearHeartbeat()
      if (socket) {
        // Se sueltan los handlers antes de cerrar. close() no es inmediato, y
        // un onclose disparado ya desmontado volvería a tocar estado del hook
        // —o a programar una reconexión— sobre un componente que ya no existe.
        socket.onopen = null
        socket.onmessage = null
        socket.onclose = null
        socket.close()
      }
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
