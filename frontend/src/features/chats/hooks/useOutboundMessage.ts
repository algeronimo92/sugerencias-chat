/**
 * El único comando de envío del chat. Texto, audio, adjuntos, sticker,
 * ubicación, contactos, interactivos y plantillas pasan por el mismo camino:
 *
 * 1. la burbuja optimista aparece al instante;
 * 2. el pedido espera su turno en la cola del chat (se respeta el orden en
 *    que el vendedor tocó "enviar", aunque un archivo tarde más en subir);
 * 3. lo que confirma el servidor reemplaza a la burbuja (o la quita si falló);
 * 4. al terminar el último envío en vuelo, el hilo se refresca una vez.
 *
 * Mientras haya envíos en vuelo (`messageKeys.sending`), el tiempo real no
 * refetchea el hilo: lo resuelve el envío.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { Message } from '../../whatsapp/types'
import { templateKeys } from '../../templates/public/keys'
import { discardFailedMessage, retryFailedMessage, sendOutbound } from '../api'
import { outboundDrafts, type OutboundMessage } from '../domain/outbound'
import { messageKeys } from '../keys'
import { enqueueForChat } from '../sendQueue'
import type { OptimisticContext } from '../types'
import {
  appendOptimisticMessages,
  mutateMessageCache,
  reconcileOptimisticMessages,
  refetchAfterLastSend,
  removeOptimisticMessages,
  replaceCachedMessage,
} from './messageCache'

export type { OutboundMessage } from '../domain/outbound'

export function useOutboundMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message[], Error, OutboundMessage, OptimisticContext>({
    mutationKey: messageKeys.sending(chatId),
    mutationFn: message => enqueueForChat(chatId, () => sendOutbound(chatId, message)),
    onMutate: async message => {
      await queryClient.cancelQueries({ queryKey: messageKeys.thread(chatId) })
      return appendOptimisticMessages(queryClient, chatId, outboundDrafts(message))
    },
    onSuccess: (messages, message, context) => {
      reconcileOptimisticMessages(queryClient, chatId, context, messages)
      // Una plantilla cuenta sus usos: el picker los ordena por eso.
      if (message.kind === 'template') void queryClient.invalidateQueries({ queryKey: templateKeys.all })
    },
    onError: (_error, _message, context) => removeOptimisticMessages(queryClient, chatId, context),
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })
}

/** Reintentar o descartar un mensaje que el canal no aceptó. */
export function useFailedMessageActions(chatId: string) {
  const queryClient = useQueryClient()

  // El reintento vuelve a mandar a WhatsApp: espera su turno en la cola.
  const retry = useMutation<Message, Error, Message>({
    mutationKey: messageKeys.sending(chatId),
    mutationFn: message => enqueueForChat(chatId, () => retryFailedMessage(chatId, message)),
    onMutate: async message => {
      await queryClient.cancelQueries({ queryKey: messageKeys.thread(chatId) })
      mutateMessageCache(queryClient, chatId, current => current.id === message.id
        ? { ...current, outbox_status: 'queued', meta_status: null, wa_message_id: null }
        : current)
    },
    onSuccess: message => replaceCachedMessage(queryClient, chatId, message),
    onError: (_error, message) => {
      mutateMessageCache(queryClient, chatId, current => current.id === message.id
        ? { ...current, outbox_status: 'failed' }
        : current)
    },
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })

  // Descartar no pasa por la cola: no envía nada a WhatsApp, solo cierra el
  // job, así que no compite por el orden del chat.
  const discard = useMutation<Message, Error, Message>({
    mutationFn: message => discardFailedMessage(chatId, message),
    onMutate: async message => {
      await queryClient.cancelQueries({ queryKey: messageKeys.thread(chatId) })
      mutateMessageCache(queryClient, chatId, current => current.id === message.id
        ? { ...current, outbox_status: 'discarded' }
        : current)
    },
    onError: (_error, message) => {
      mutateMessageCache(queryClient, chatId, current => current.id === message.id
        ? { ...current, outbox_status: 'failed' }
        : current)
    },
  })

  return {
    retryMessage(message: Message) {
      if (message.outbox_status !== 'failed' || message.id < 1) return
      retry.mutate(message)
    },
    discardMessage(message: Message) {
      if (message.outbox_status !== 'failed' || message.id < 1) return
      discard.mutate(message)
    },
    error: retry.error ?? discard.error,
  }
}
