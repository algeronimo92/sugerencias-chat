import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useChatSocketConnected } from '../../../realtime/useRealtime'
import { fetchMessages, forwardMessages, pinMessage, fetchPinnedMessages, reactToMessage, unpinMessage } from '../api'
import type { ForwardPayload, ForwardResult, MessageCursor, ReactionPayload } from '../types'
import type { Message, MessageReaction } from '../../whatsapp/types'
import { messageKeys } from '../keys'
import { leadKeys } from '../../leads/public/keys'
import { mutateMessageCache, replaceCachedMessage } from './messageCache'

// untilId no forma parte de la queryKey a propósito: los updates optimistas
// de useSendMessage escriben sobre messageKeys.thread(chatId) exacto. Solo influye
// en cómo se pide la primera página cuando la cache está vacía; si el chat ya
// estaba cacheado sin el mensaje buscado, ChatThread pagina hacia atrás hasta
// encontrarlo.
export function useMessages(chatId: string | null, untilId?: number | null) {
  const connected = useChatSocketConnected()
  return useInfiniteQuery({
    queryKey: messageKeys.thread(chatId),
    queryFn: ({ pageParam }) => fetchMessages(chatId as string, pageParam, untilId),
    enabled: !!chatId,
    initialPageParam: null as MessageCursor,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more || lastPage.items.length === 0) return undefined
      const oldest = lastPage.items[0]
      if (!oldest.sent_at) return undefined
      return { cursorTs: oldest.sent_at, cursorId: oldest.id }
    },
    staleTime: 15_000,
    // Respaldo solo con el WebSocket caído: con el socket arriba, los estados
    // llegan por applyMessageStatuses y el resto de cambios invalida esta
    // query. Es un infinite query, así que cada tick repide todas las páginas
    // cargadas. El navegador lo pausa con la pestaña en segundo plano.
    refetchInterval: connected ? false : 15_000,
    refetchIntervalInBackground: false,
    retry: false,
  })
}

export type { ReplyTarget } from '../types'

/** Reemplaza la reacción propia (from_me) por `emoji`; un emoji vacío la quita.
 * Espeja la lógica de merge del backend (set_message_reaction) para que el
 * badge optimista quede igual a lo que va a devolver el servidor. */
function applyOwnReaction(reactions: MessageReaction[] | null, emoji: string): MessageReaction[] | null {
  const others = (reactions ?? []).filter(r => !r.from_me)
  const next = emoji ? [...others, { emoji, from_me: true }] : others
  return next.length ? next : null
}

export function useReactToMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, ReactionPayload, { previous: MessageReaction[] | null }>({
    mutationFn: (variables: ReactionPayload) => reactToMessage(chatId, variables),
    onMutate: async ({ messageId, emoji }) => {
      await queryClient.cancelQueries({ queryKey: messageKeys.thread(chatId) })
      let previous: MessageReaction[] | null = null
      mutateMessageCache(queryClient, chatId, message => {
        if (message.id !== messageId) return message
        previous = message.reactions ?? null
        return { ...message, reactions: applyOwnReaction(message.reactions ?? null, emoji) }
      })
      return { previous }
    },
    onSuccess: message => {
      replaceCachedMessage(queryClient, chatId, message)
    },
    onError: (_error, { messageId }, context) => {
      mutateMessageCache(queryClient, chatId, current => current.id === messageId
        ? { ...current, reactions: context?.previous ?? null }
        : current)
    },
  })
}

/** Hasta 3 mensajes fijados del chat — Meta no tiene forma de mandar un
 * fijado hacia el otro lado, así que esto es un fijado nativo del CRM y vive en su propio endpoint: un mensaje
 * fijado puede estar fuera de la página del hilo que está cargada. */
export function usePinnedMessages(chatId: string | null) {
  return useQuery({
    queryKey: messageKeys.pinned(chatId),
    queryFn: () => fetchPinnedMessages(chatId),
    enabled: !!chatId,
  })
}

export function usePinMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, number>({
    mutationFn: (messageId: number) => pinMessage(chatId, messageId),
    onSuccess: message => {
      replaceCachedMessage(queryClient, chatId, message)
      void queryClient.invalidateQueries({ queryKey: messageKeys.pinned(chatId) })
    },
  })
}

export function useUnpinMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, number>({
    mutationFn: (messageId: number) => unpinMessage(chatId, messageId),
    onSuccess: message => {
      replaceCachedMessage(queryClient, chatId, message)
      void queryClient.invalidateQueries({ queryKey: messageKeys.pinned(chatId) })
    },
  })
}

export type { ForwardPayload } from '../types'

export type { ForwardResult } from '../types'

/** Reenvía mensajes de este chat a otros leads (el "Reenviar" de WhatsApp).
 *
 * El backend encola un mensaje nuevo por destino, así que lo único que hay que
 * refrescar acá es la lista (cambió el último mensaje de esos chats) y el hilo
 * del destino si estaba abierto — de eso ya se encarga el broadcast, pero la
 * invalidación deja la lista al día aunque el websocket esté caído. */
export function useForwardMessages(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<ForwardResult, Error, ForwardPayload>({
    mutationFn: (variables: ForwardPayload) => forwardMessages(chatId, variables),
    onSuccess: (_result, { targetChatIds }) => {
      void queryClient.invalidateQueries({ queryKey: leadKeys.all })
      for (const target of targetChatIds) {
        void queryClient.invalidateQueries({ queryKey: messageKeys.thread(target) })
      }
    },
  })
}
