import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'
import type { NavigateFunction } from 'react-router-dom'
import type { Message } from '../types'
import type { NotificationOptions } from '../hooks/useNotifications'
import { parseContent } from '../utils/message'
import { NotificationType } from '../domain/automationCatalog'
import type { ChatSocketEvent, ChatsUpdateReason, MessageStatusUpdate, RealtimeEventType, SocketEventOf } from './socketEvents'

export type NotifyFn = (title: string, body: string, onClick: () => void, options?: NotificationOptions) => void
export interface InternalMentionAlert { notificationId: number; leadId: string; authorName: string; content: string }
export type InternalMentionFn = (alert: InternalMentionAlert) => void

export interface SocketHandlerContext {
  queryClient: QueryClient
  navigate: NavigateFunction
  notify: NotifyFn
  onInternalMention: InternalMentionFn
  lastNotifiedMessageId: { current: string | null }
}

type SocketHandler<K extends RealtimeEventType> = (event: SocketEventOf<K>, context: SocketHandlerContext) => void

interface CachedMessagePage {
  items: Message[]
  has_more: boolean
}

const KANBAN_REASONS: ReadonlySet<ChatsUpdateReason> = new Set(['lead_created', 'lead_updated', 'stage_changed', 'tag_changed'])
const DASHBOARD_REASONS: ReadonlySet<ChatsUpdateReason> = new Set(['inbound_message', 'outbound_message', 'lead_created', 'stage_changed'])
const PREVIEW_MAX_LENGTH = 140

function invalidate(queryClient: QueryClient, ...queryKeys: QueryKey[]) {
  for (const queryKey of queryKeys) queryClient.invalidateQueries({ queryKey })
}

function preview(text: string) {
  return text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH - 3)}...` : text
}

function applyMessageStatuses(queryClient: QueryClient, chatId: string, updates: MessageStatusUpdate[]) {
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

const NOTIFICATION_DESTINATIONS: Record<string, (notification: SocketEventOf<'notification_created'>['notification']) => string | null> = {
  [NotificationType.IssueReport]: notification => (
    notification.metadata?.issue_report_id ? `/reports?report=${notification.metadata.issue_report_id}` : '/reports'
  ),
  [NotificationType.Appointment]: () => '/citas/nueva',
}

const handleChatsUpdated: SocketHandler<'chats_updated'> = (event, { queryClient, navigate, notify, lastNotifiedMessageId }) => {
  const latest = event.latest_message
  const changedChatId = event.chat_id ?? latest?.chat_id
  const reason = event.reason
  const isStatusOnly = reason === 'message_status'

  if (!isStatusOnly) invalidate(queryClient, ['chats'], ['unread-count'])
  if (changedChatId) {
    applyMessageStatuses(queryClient, changedChatId, event.message_statuses)
    if (!isStatusOnly) invalidate(queryClient, ['chat', changedChatId])
    if (reason !== 'message_status' && reason !== 'read') invalidate(queryClient, ['lead-activity', changedChatId])
    if (!isStatusOnly && queryClient.isMutating({ mutationKey: ['send-message', changedChatId] }) === 0) {
      invalidate(queryClient, ['messages', changedChatId])
    }
    if (reason === 'inbound_message') invalidate(queryClient, ['customer-service-window', changedChatId])
    if (reason === 'message_pinned') invalidate(queryClient, ['pinned-messages', changedChatId])
  } else {
    invalidate(queryClient, ['messages'], ['lead-activity'], ['customer-service-window'])
  }
  if (!changedChatId || (reason && KANBAN_REASONS.has(reason))) invalidate(queryClient, ['kanban'])
  if (reason && DASHBOARD_REASONS.has(reason)) invalidate(queryClient, ['dashboard'])

  if (latest?.sender !== 'cliente') return
  invalidate(queryClient, ['suggestions', latest.chat_id])
  if (latest.message_id === lastNotifiedMessageId.current) return
  lastNotifiedMessageId.current = latest.message_id
  const content = parseContent({ content: latest.content, message_type: latest.message_type })
  notify(latest.name || 'Nuevo mensaje', content.text || content.label || 'Mensaje nuevo', () => {
    navigate(`/chat/${latest.chat_id}`)
  })
}

export const SOCKET_EVENT_HANDLERS: { [K in RealtimeEventType]: SocketHandler<K> } = {
  tasks_updated: (_event, { queryClient }) => invalidate(queryClient, ['tasks'], ['dashboard']),
  templates_updated: (_event, { queryClient }) => invalidate(queryClient, ['templates']),
  media_library_updated: (_event, { queryClient }) => invalidate(queryClient, ['media-library']),
  notifications_updated: (_event, { queryClient }) => invalidate(queryClient, ['notifications']),
  automations_updated: (_event, { queryClient }) => invalidate(queryClient, ['automations'], ['automation-executions']),
  issue_reports_updated: (_event, { queryClient }) => invalidate(queryClient, ['issue-reports']),
  scheduled_messages_updated: (event, { queryClient }) => invalidate(
    queryClient,
    event.chat_id ? ['scheduled-messages', event.chat_id] : ['scheduled-messages'],
  ),
  internal_notes_updated: (event, { queryClient }) => invalidate(
    queryClient, ['internal-notes', event.lead_id], ['lead-activity', event.lead_id],
  ),
  notification_created: ({ notification }, { queryClient, navigate, notify, onInternalMention }) => {
    invalidate(queryClient, ['notifications'])
    notify(
      notification.title,
      preview(notification.body),
      () => {
        const destination = NOTIFICATION_DESTINATIONS[notification.notification_type]?.(notification)
          ?? (notification.lead_id ? `/chat/${notification.lead_id}` : null)
        if (destination) navigate(destination)
      },
      { force: true, tag: `notification-${notification.id}` },
    )
    if (notification.notification_type === NotificationType.InternalNoteMention && notification.lead_id) {
      onInternalMention({
        notificationId: notification.id,
        leadId: notification.lead_id,
        authorName: notification.metadata?.author_name ?? 'Un usuario',
        content: notification.body,
      })
    }
  },
  task_reminder: ({ task }, { queryClient, navigate, notify }) => {
    invalidate(queryClient, ['tasks'])
    notify(
      `Recordatorio: ${task.lead_name || 'Lead'}`,
      task.title,
      () => navigate(`/chat/${task.lead_id}`),
      { force: true, tag: `task-reminder-${task.task_id}` },
    )
  },
  chats_updated: handleChatsUpdated,
}

export function dispatchSocketEvent(event: ChatSocketEvent, context: SocketHandlerContext) {
  const handler = SOCKET_EVENT_HANDLERS[event.type] as (event: ChatSocketEvent, context: SocketHandlerContext) => void
  handler(event, context)
}
