/**
 * Tiempo real de la bandeja y el hilo: qué se refresca cuando cambia un chat,
 * los estados de envío que se parchean sin refetch y el aviso de un mensaje
 * nuevo del cliente.
 */

import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import { invalidate, type RealtimeModule } from '../../realtime/bus'
import type { LatestMessage, MessageStatusUpdate, SocketEventOf } from '../../realtime/socketEvents'
import { messageKeys, noteKeys, scheduledKeys } from './keys'
import type { MessagePage } from './types'
import { highlightSegments, parseContent, searchTerms } from '../whatsapp/public/message'
import { leadKeys, messageSearchTerm } from '../leads/public/keys'
import { whatsappKeys } from '../platform/public/keys'

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

function messageText(latest: LatestMessage): string {
  const content = parseContent({ content: latest.content, message_type: latest.message_type, message_subtype: latest.message_subtype })
  return content.text || ''
}

/**
 * ¿Este aviso puede cambiar lo que muestra una búsqueda de mensajes abierta?
 *
 * La búsqueda recorre el historial entero del negocio. Refrescarla con cada
 * aviso la repetía por cada WhatsApp que entraba a cualquier chat, y las
 * repeticiones se apilaban: el 2026-11-24 una sola búsqueda abierta dejó la
 * base al 150 % de CPU y el backend sin responder al chequeo de salud. Ahora
 * solo se repite si el mensaje nuevo contiene lo buscado, si un mensaje se
 * editó o eliminó, o si el aviso no dice qué cambió.
 */
function affectsMessageSearch(event: SocketEventOf<'chats_updated'>, search: string): boolean {
  if (event.reason === 'message_changed') return true
  const latest = event.latest_message
  if (!latest) return !event.chat_id && !event.reason
  const text = messageText(latest)
  return searchTerms(search).every(term => highlightSegments(text, term).some(segment => segment.match))
}

export function createChatsRealtime(): RealtimeModule {
  // El mismo mensaje puede llegar en más de un aviso: se avisa una sola vez.
  let lastNotifiedMessageId: string | null = null

  return {
    handlers: {
      lead_visibility_changed: (_event, { queryClient }) => {
        void queryClient.resetQueries({ queryKey: messageKeys.all })
        void queryClient.resetQueries({ queryKey: messageKeys.pinnedAll })
        void queryClient.resetQueries({ queryKey: messageKeys.serviceWindowAll })
        void queryClient.resetQueries({ queryKey: noteKeys.all })
        void queryClient.resetQueries({ queryKey: scheduledKeys.all })
      },
      chats_updated: (event, { queryClient, navigate, notify }) => {
        const latest = event.latest_message
        const changedChatId = event.chat_id ?? latest?.chat_id
        const reason = event.reason
        // Un acuse de entrega no cambia nada visible fuera del hilo: se
        // parchea el estado en la caché sin pedir nada.
        const isStatusOnly = reason === 'message_status'

        if (!isStatusOnly) {
          void queryClient.invalidateQueries({
            queryKey: leadKeys.all,
            predicate: query => {
              const search = messageSearchTerm(query.queryKey)
              return search === null || affectsMessageSearch(event, search)
            },
          })
          invalidate(queryClient, leadKeys.unreadCount)
        }
        if (changedChatId) {
          applyMessageStatuses(queryClient, changedChatId, event.message_statuses)
          // Un envío fallido puede ser el primer síntoma de que WhatsApp se
          // desconectó: el aviso del chat no espera al próximo sondeo.
          if (event.message_statuses.some(update => update.outbox_status === 'failed')) {
            invalidate(queryClient, whatsappKeys.status)
          }
          if (!isStatusOnly) invalidate(queryClient, leadKeys.detail(changedChatId))
          // Con un envío en vuelo el hilo lo resuelve el envío, no un refetch.
          if (!isStatusOnly && queryClient.isMutating({ mutationKey: messageKeys.sending(changedChatId) }) === 0) {
            invalidate(queryClient, messageKeys.thread(changedChatId))
          }
          // El primer `sent` de una respuesta a un cliente que llegó por
          // anuncio trae la ventana gratis de Meta (y cierra el aviso de
          // "responde a tiempo").
          const sentNow = event.message_statuses?.some(status => status.meta_status === 'sent')
          if (reason === 'inbound_message' || sentNow) invalidate(queryClient, messageKeys.serviceWindow(changedChatId))
          // Un mensaje fijado puede editarse o eliminarse desde WhatsApp.
          if (reason === 'message_pinned' || reason === 'message_changed') invalidate(queryClient, messageKeys.pinned(changedChatId))
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
      scheduled_messages_updated: (event, { queryClient }) => invalidate(
        queryClient,
        event.chat_id ? scheduledKeys.chat(event.chat_id) : scheduledKeys.all,
      ),
      internal_notes_updated: (event, { queryClient }) => invalidate(queryClient, noteKeys.chat(event.lead_id)),
    },
    resync: [leadKeys.all, leadKeys.unreadCount, messageKeys.all, leadKeys.detailAll],
  }
}
