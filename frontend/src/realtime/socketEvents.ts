import type { JsonValue, MessageStatus, MessageType } from '../types'
import { isJsonObject } from '../utils/message'

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
] as const
export type RealtimeEventType = typeof REALTIME_EVENT_TYPES[number]

export const CHATS_UPDATE_REASONS = [
  'inbound_message',
  'external_message',
  'outbound_queued',
  'outbound_message',
  'message_status',
  'message_edited',
  'message_deleted',
  'message_pinned',
  'reaction',
  'poll_results',
  'analysis',
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

const MESSAGE_STATUS_VALUES: ReadonlySet<string> = new Set([
  'PENDING', 'FAILED', 'DISCARDED', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED',
])

const MESSAGE_TYPE_VALUES: ReadonlySet<string> = new Set([
  'text', 'image', 'video', 'ptv', 'audio', 'document', 'location', 'sticker',
  'contact', 'poll', 'reaction', 'pin', 'interactive', 'template', 'order', 'product',
  'payment', 'view_once', 'unsupported',
])

export interface MessageStatusUpdate {
  id: number
  status: Exclude<MessageStatus, null>
}

export interface LatestMessage {
  message_id: string
  chat_id: string
  sender: string
  content: string | null
  message_type?: MessageType | null
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

type SignalEventType = 'tasks_updated' | 'templates_updated' | 'media_library_updated' | 'notifications_updated' | 'automations_updated' | 'issue_reports_updated'

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

function isMessageStatus(value: string): value is Exclude<MessageStatus, null> {
  return MESSAGE_STATUS_VALUES.has(value)
}

function isMessageType(value: string): value is MessageType {
  return MESSAGE_TYPE_VALUES.has(value)
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
    message_type: typeof rawLatest.message_type === 'string' && isMessageType(rawLatest.message_type)
      ? rawLatest.message_type
      : null,
    name: rawLatest.name,
  }
}

function parseChatsUpdated(parsed: JsonObject): ChatSocketEvent {
  const messageStatuses = Array.isArray(parsed.message_statuses)
    ? parsed.message_statuses.flatMap(item => isJsonObject(item)
      && typeof item.id === 'number'
      && typeof item.status === 'string'
      && isMessageStatus(item.status)
      ? [{ id: item.id, status: item.status }]
      : [])
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
