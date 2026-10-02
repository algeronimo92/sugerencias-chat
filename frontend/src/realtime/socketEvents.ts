import type { JsonValue } from '../shared/types'
import type { MessageType, MetaStatus, OutboxStatus } from '../features/chats/types'
import { isJsonObject } from '../features/chats/utils/message'

export const REALTIME_EVENT_TYPES = [
  'chats_updated',
  'tasks_updated',
  'task_reminder',
  'scheduled_messages_updated',
  'internal_notes_updated',
  'notification_created',
  'notifications_updated',
  'issue_reports_updated',
  'templates_updated',
  'media_library_updated',
  'automations_updated',
  'lead_stages_updated',
] as const
export type RealtimeEventType = typeof REALTIME_EVENT_TYPES[number]

export const CHATS_UPDATE_REASONS = [
  'inbound_message',
  'external_message',
  'outbound_queued',
  'outbound_message',
  'message_status',
  'message_pinned',
  'reaction',
  'media_ready',
  'read',
  'unread',
  'lead_created',
  'lead_updated',
  'lead_deleted',
  'stage_changed',
  'tag_changed',
  'conversation_opened',
  'conversation_closed',
] as const
export type ChatsUpdateReason = typeof CHATS_UPDATE_REASONS[number]

const REALTIME_EVENT_TYPE_SET: ReadonlySet<string> = new Set(REALTIME_EVENT_TYPES)
const CHATS_UPDATE_REASON_SET: ReadonlySet<string> = new Set(CHATS_UPDATE_REASONS)

const OUTBOX_STATUS_VALUES: ReadonlySet<string> = new Set([
  'queued', 'sending', 'sent', 'retryable_failed', 'failed', 'discarded',
])

/** Cambio de estado de un mensaje: el de la cola propia, el literal de Meta
 * o los dos. Un campo ausente no se toca. */
export interface MessageStatusUpdate {
  id: number
  outbox_status?: OutboxStatus
  meta_status?: MetaStatus
}

export interface LatestMessage {
  message_id: string
  chat_id: string
  sender: string
  content: string | null
  message_type?: MessageType | null
  message_subtype?: string | null
  name: string | null
}

export interface CreatedNotification {
  id: number
  notification_type: string
  title: string
  body: string
  lead_id: string | null
  metadata: { author_name?: string; issue_report_id?: number } | null
}

type SignalEventType = 'tasks_updated' | 'templates_updated' | 'media_library_updated' | 'notifications_updated' | 'automations_updated' | 'issue_reports_updated' | 'lead_stages_updated'

export type ChatSocketEvent =
  | { [K in SignalEventType]: { type: K } }[SignalEventType]
  | { type: 'scheduled_messages_updated'; chat_id?: string }
  | { type: 'internal_notes_updated'; lead_id: string }
  | { type: 'notification_created'; notification: CreatedNotification }
  | { type: 'task_reminder'; task: { task_id: number; lead_id: string; lead_name: string | null; title: string } }
  | {
      type: 'chats_updated'
      chat_id?: string
      reason?: ChatsUpdateReason
      latest_message?: LatestMessage
      message_statuses: MessageStatusUpdate[]
    }

export type SocketEventOf<K extends RealtimeEventType> = Extract<ChatSocketEvent, { type: K }>

function isRealtimeEventType(value: string): value is RealtimeEventType {
  return REALTIME_EVENT_TYPE_SET.has(value)
}

function isChatsUpdateReason(value: JsonValue | undefined): value is ChatsUpdateReason {
  return typeof value === 'string' && CHATS_UPDATE_REASON_SET.has(value)
}

function isOutboxStatus(value: JsonValue | undefined): value is OutboxStatus {
  return typeof value === 'string' && OUTBOX_STATUS_VALUES.has(value)
}

function isNullableString(value: JsonValue | undefined): value is string | null {
  return value === null || typeof value === 'string'
}

type JsonObject = { [key: string]: JsonValue }
type SocketEventParser = (parsed: JsonObject) => ChatSocketEvent | null

function parseNotification(parsed: JsonObject): ChatSocketEvent | null {
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
    type: 'notification_created',
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

function parseTaskReminder(parsed: JsonObject): ChatSocketEvent | null {
  const task = parsed.task
  if (
    !isJsonObject(task)
    || typeof task.task_id !== 'number'
    || typeof task.lead_id !== 'string'
    || !isNullableString(task.lead_name)
    || typeof task.title !== 'string'
  ) return null
  return {
    type: 'task_reminder',
    task: { task_id: task.task_id, lead_id: task.lead_id, lead_name: task.lead_name, title: task.title },
  }
}

function parseLatestMessage(rawLatest: JsonValue | undefined): LatestMessage | undefined {
  if (
    !isJsonObject(rawLatest)
    || typeof rawLatest.message_id !== 'string'
    || typeof rawLatest.chat_id !== 'string'
    || typeof rawLatest.sender !== 'string'
    || !isNullableString(rawLatest.content)
    || !isNullableString(rawLatest.name)
  ) return undefined
  return {
    message_id: rawLatest.message_id,
    chat_id: rawLatest.chat_id,
    sender: rawLatest.sender,
    content: rawLatest.content,
    // Tipo literal de Meta: uno que el contrato todavía no conoce llega igual.
    message_type: typeof rawLatest.message_type === 'string' ? rawLatest.message_type : null,
    message_subtype: typeof rawLatest.message_subtype === 'string' ? rawLatest.message_subtype : null,
    name: rawLatest.name,
  }
}

function parseChatsUpdated(parsed: JsonObject): ChatSocketEvent {
  const messageStatuses = Array.isArray(parsed.message_statuses)
    ? parsed.message_statuses.flatMap((item): MessageStatusUpdate[] => {
      if (!isJsonObject(item) || typeof item.id !== 'number') return []
      const update: MessageStatusUpdate = { id: item.id }
      if (isOutboxStatus(item.outbox_status)) update.outbox_status = item.outbox_status
      if (typeof item.meta_status === 'string') update.meta_status = item.meta_status
      return update.outbox_status || update.meta_status ? [update] : []
    })
    : []
  return {
    type: 'chats_updated',
    chat_id: typeof parsed.chat_id === 'string' ? parsed.chat_id : undefined,
    reason: isChatsUpdateReason(parsed.reason) ? parsed.reason : undefined,
    latest_message: parseLatestMessage(parsed.latest_message),
    message_statuses: messageStatuses,
  }
}

const signal = (type: SignalEventType): SocketEventParser => () => ({ type })

const SOCKET_EVENT_PARSERS: Record<RealtimeEventType, SocketEventParser> = {
  tasks_updated: signal('tasks_updated'),
  templates_updated: signal('templates_updated'),
  media_library_updated: signal('media_library_updated'),
  notifications_updated: signal('notifications_updated'),
  automations_updated: signal('automations_updated'),
  issue_reports_updated: signal('issue_reports_updated'),
  lead_stages_updated: signal('lead_stages_updated'),
  scheduled_messages_updated: parsed => ({
    type: 'scheduled_messages_updated',
    chat_id: typeof parsed.chat_id === 'string' ? parsed.chat_id : undefined,
  }),
  internal_notes_updated: parsed => (
    typeof parsed.lead_id === 'string' ? { type: 'internal_notes_updated', lead_id: parsed.lead_id } : null
  ),
  notification_created: parseNotification,
  task_reminder: parseTaskReminder,
  chats_updated: parseChatsUpdated,
}

export function parseChatSocketEvent(data: string): ChatSocketEvent | null {
  const parsed: JsonValue = JSON.parse(data)
  if (!isJsonObject(parsed) || typeof parsed.type !== 'string' || !isRealtimeEventType(parsed.type)) return null
  return SOCKET_EVENT_PARSERS[parsed.type](parsed)
}
