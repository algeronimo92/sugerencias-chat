/**
 * Tiempo real de la bandeja y el hilo: qué se refresca cuando cambia un chat,
 * los estados de envío que se parchean sin refetch y el aviso de un mensaje
 * nuevo del cliente.
 */

import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import { invalidate, type RealtimeModule } from '../../realtime/bus'
import type { MessageStatusUpdate } from '../../realtime/socketEvents'
import { chatKeys, messageKeys, noteKeys, scheduledKeys, templateKeys } from './keys'
import type { MessagePage } from './types'
import { parseContent } from '../whatsapp/public/message'

function applyMessageStatuses(queryClient: QueryClient, chatId: string, updates: MessageStatusUpdate[]) {
  if (!updates.length) return
  const byId = new Map(updates.map(update => [update.id, update]))
  queryClient.setQueryData<InfiniteData<MessagePage>>(messageKeys.thread(chatId), current => {
    if (!current) return current
    return {
      ...current,
      pages: current.pages.map(page => ({
        ...page,
        items: page.items.map(message => {
          const update = byId.get(message.id)
          if (!update) return message
          return {
            ...message,
            outbox_status: update.outbox_status ?? message.outbox_status,
            meta_status: update.meta_status ?? message.meta_status,
          }
        }),
      })),
    }
  })
}

export function createChatsRealtime(): RealtimeModule {
  // El mismo mensaje puede llegar en más de un aviso: se avisa una sola vez.
  let lastNotifiedMessageId: string | null = null

  return {
    handlers: {
      chats_updated: (event, { queryClient, navigate, notify }) => {
        const latest = event.latest_message
        const changedChatId = event.chat_id ?? latest?.chat_id
        const reason = event.reason
        // Un acuse de entrega no cambia nada visible fuera del hilo: se
        // parchea el estado en la caché sin pedir nada.
        const isStatusOnly = reason === 'message_status'

        if (!isStatusOnly) invalidate(queryClient, chatKeys.all, chatKeys.unreadCount)
        if (changedChatId) {
          applyMessageStatuses(queryClient, changedChatId, event.message_statuses)
          if (!isStatusOnly) invalidate(queryClient, chatKeys.detail(changedChatId))
          // Con un envío en vuelo el hilo lo resuelve el envío, no un refetch.
          if (!isStatusOnly && queryClient.isMutating({ mutationKey: messageKeys.sending(changedChatId) }) === 0) {
            invalidate(queryClient, messageKeys.thread(changedChatId))
          }
          if (reason === 'inbound_message') invalidate(queryClient, messageKeys.serviceWindow(changedChatId))
          if (reason === 'message_pinned') invalidate(queryClient, messageKeys.pinned(changedChatId))
        } else {
          invalidate(queryClient, messageKeys.all, messageKeys.serviceWindowAll)
        }

        if (latest?.sender !== 'cliente') return
        if (latest.message_id === lastNotifiedMessageId) return
        lastNotifiedMessageId = latest.message_id
        const content = parseContent({ content: latest.content, message_type: latest.message_type, message_subtype: latest.message_subtype })
        notify(latest.name || 'Nuevo mensaje', content.text || content.label || 'Mensaje nuevo', () => {
          navigate(`/chat/${latest.chat_id}`)
        })
      },
      templates_updated: (_event, { queryClient }) => invalidate(queryClient, templateKeys.all),
      scheduled_messages_updated: (event, { queryClient }) => invalidate(
        queryClient,
        event.chat_id ? scheduledKeys.chat(event.chat_id) : scheduledKeys.all,
      ),
      internal_notes_updated: (event, { queryClient }) => invalidate(queryClient, noteKeys.chat(event.lead_id)),
    },
    resync: [chatKeys.all, chatKeys.unreadCount, messageKeys.all, chatKeys.detailAll, templateKeys.all],
  }
}
