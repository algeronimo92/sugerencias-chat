/**
 * Escrituras sobre la caché del hilo de un chat: las burbujas optimistas de
 * un envío, su reconciliación con lo que confirma el servidor y los parches
 * de un mensaje puntual (reacción, fijado, reintento).
 */

import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import type { Message } from '../../whatsapp/types'
import { messageKeys } from '../keys'
import type { MessagePage, OptimisticContext, OptimisticMessageDraft } from '../types'

let nextOptimisticMessageId = -1
let lastOptimisticTimestamp = 0

function optimisticMessage(draft: OptimisticMessageDraft): Message {
  const timestamp = Math.max(Date.now(), lastOptimisticTimestamp + 1)
  lastOptimisticTimestamp = timestamp
  return {
    id: nextOptimisticMessageId--,
    sender: 'vendedor',
    content: draft.content,
    sent_at: new Date(timestamp).toISOString(),
    media_url: draft.media_url ?? null,
    wa_message_id: null,
    outbox_status: 'queued',
    message_type: draft.message_type ?? null,
    message_subtype: draft.message_subtype ?? null,
    direction: 'outbound',
    analysis: null,
    payload: draft.payload ?? null,
    provider_payload: draft.provider_payload ?? null,
    quoted_message_id: draft.reply_to?.id ?? null,
    quoted_sender: draft.reply_to?.sender ?? null,
    quoted_content: draft.reply_to?.content ?? null,
    // Lo que el servidor completa al confirmar el envío.
    meta_status: null,
    status_payload: null,
    reactions: null,
    edited_at: null,
    deleted_at: null,
    media_width: null,
    media_height: null,
    quoted_message_type: null,
    pinned_at: null,
    error_detail: null,
  }
}

/** Reemplaza (o quita, devolviendo null) mensajes del hilo cargado. */
export function mutateMessageCache(
  queryClient: QueryClient,
  chatId: string,
  update: (message: Message) => Message | null,
) {
  queryClient.setQueryData<InfiniteData<MessagePage>>(messageKeys.thread(chatId), current => {
    if (!current) return current
    return {
      ...current,
      pages: current.pages.map(page => ({
        ...page,
        items: page.items.map(update).filter((message): message is Message => message !== null),
      })),
    }
  })
}

/** Pone un mensaje confirmado por el servidor en lugar del que había. */
export function replaceCachedMessage(queryClient: QueryClient, chatId: string, message: Message) {
  mutateMessageCache(queryClient, chatId, current => current.id === message.id ? message : current)
}

export function appendOptimisticMessages(
  queryClient: QueryClient,
  chatId: string,
  drafts: OptimisticMessageDraft[],
): OptimisticContext {
  const messages = drafts.map(optimisticMessage)
  queryClient.setQueryData<InfiniteData<MessagePage>>(messageKeys.thread(chatId), current => {
    if (!current) return { pages: [{ items: messages, has_more: false }], pageParams: [null] }
    const pages = [...current.pages]
    const newestPage = pages[0] ?? { items: [], has_more: false }
    pages[0] = { ...newestPage, items: [...newestPage.items, ...messages] }
    return { ...current, pages }
  })
  return { optimisticIds: messages.map(message => message.id) }
}

export function removeOptimisticMessages(queryClient: QueryClient, chatId: string, context?: OptimisticContext) {
  if (!context) return
  const ids = new Set(context.optimisticIds)
  mutateMessageCache(queryClient, chatId, message => ids.has(message.id) ? null : message)
}

export function reconcileOptimisticMessages(
  queryClient: QueryClient,
  chatId: string,
  context: OptimisticContext | undefined,
  serverMessages: Message[],
) {
  const optimisticIds = new Set(context?.optimisticIds ?? [])
  queryClient.setQueryData<InfiniteData<MessagePage>>(messageKeys.thread(chatId), current => {
    const base = current ?? { pages: [{ items: [], has_more: false }], pageParams: [null] }
    const pages = base.pages.map(page => ({
      ...page,
      items: page.items.filter(message => !optimisticIds.has(message.id)),
    }))
    const knownIds = new Set(pages.flatMap(page => page.items.map(message => message.id)))
    const missing = serverMessages.filter(message => !knownIds.has(message.id))
    const newestPage = pages[0] ?? { items: [], has_more: false }
    pages[0] = { ...newestPage, items: [...newestPage.items, ...missing] }
    return { ...base, pages }
  })
}

/** Cierra la carrera entre el broadcast del worker y la respuesta del POST.
 * El último envío en vuelo siempre hace un refetch una vez reconciliado. */
export function refetchAfterLastSend(queryClient: QueryClient, chatId: string) {
  // onSettled corre antes de que TanStack cambie la mutación a success/error.
  // Un timer (no un microtask) deja que esa transición finalice primero.
  setTimeout(() => {
    if (queryClient.isMutating({ mutationKey: messageKeys.sending(chatId) }) === 0) {
      void queryClient.invalidateQueries({ queryKey: messageKeys.thread(chatId) })
    }
  }, 0)
}
