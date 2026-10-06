import { orderedRequest } from '../api'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useChatSocketConnected } from '../../../realtime/useRealtime'
import { fetchMessages, forwardMessages, pinMessage, fetchPinnedMessages, reactToMessage, sendInteractive, sendMessage, retryFailedMessage, discardFailedMessage, sendTemplate, unpinMessage, sendAudio, sendContacts, sendLocation, sendMedia, sendSticker } from '../api'
import type { AudioPayload, ContactsPayload, ForwardPayload, ForwardResult, InteractivePayload, LocationPayload, MediaPayload, Message, MessageCursor, MessagePage, MessageReaction, MessageType, OptimisticContext, OptimisticMessageDraft, ReactionPayload, SendTemplatePayload, StickerPayload, TextPayload } from '../types'
import { chatKeys, messageKeys, templateKeys } from '../keys'

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

let nextOptimisticMessageId = -1
let lastOptimisticTimestamp = 0

export type { ReplyTarget } from '../types'

export type { OptimisticMessageDraft } from '../types'

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

function mutateMessageCache(
  queryClient: ReturnType<typeof useQueryClient>,
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

function appendOptimisticMessages(
  queryClient: ReturnType<typeof useQueryClient>,
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

function removeOptimisticMessages(
  queryClient: ReturnType<typeof useQueryClient>, chatId: string, context?: OptimisticContext,
) {
  if (!context) return
  const ids = new Set(context.optimisticIds)
  mutateMessageCache(queryClient, chatId, message => ids.has(message.id) ? null : message)
}

function reconcileOptimisticMessages(
  queryClient: ReturnType<typeof useQueryClient>,
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
function refetchAfterLastSend(queryClient: ReturnType<typeof useQueryClient>, chatId: string) {
  // onSettled corre antes de que TanStack cambie la mutación a success/error.
  // Un timer (no un microtask) deja que esa transición finalice primero.
  setTimeout(() => {
    if (queryClient.isMutating({ mutationKey: messageKeys.sending(chatId) }) === 0) {
      void queryClient.invalidateQueries({ queryKey: messageKeys.thread(chatId) })
    }
  }, 0)
}

export type { TextPayload } from '../types'

export function useSendMessage(chatId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation<Message, Error, TextPayload, OptimisticContext>({
    mutationKey: messageKeys.sending(chatId),
    mutationFn: (variables: TextPayload) => sendMessage(chatId, variables),
    onMutate: async ({ text, replyTo }) => {
      await queryClient.cancelQueries({ queryKey: messageKeys.thread(chatId) })
      return appendOptimisticMessages(queryClient, chatId, [{ content: text, reply_to: replyTo }])
    },
    onSuccess: (message, _payload, context) => {
      reconcileOptimisticMessages(queryClient, chatId, context, [message])
    },
    onError: (_error, _payload, context) => {
      removeOptimisticMessages(queryClient, chatId, context)
    },
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })

  const retry = useMutation<Message, Error, Message>({
    mutationKey: messageKeys.sending(chatId),
    mutationFn: (message: Message) => retryFailedMessage(chatId, message),
    onMutate: async message => {
      await queryClient.cancelQueries({ queryKey: messageKeys.thread(chatId) })
      mutateMessageCache(queryClient, chatId, current => current.id === message.id
        ? { ...current, outbox_status: 'queued', meta_status: null, wa_message_id: null }
        : current)
    },
    onSuccess: message => {
      mutateMessageCache(queryClient, chatId, current => current.id === message.id ? message : current)
    },
    onError: (_error, message) => {
      mutateMessageCache(queryClient, chatId, current => current.id === message.id
        ? { ...current, outbox_status: 'failed' }
        : current)
    },
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })

  // Descartar no pasa por orderedRequest: no envía nada a WhatsApp, solo cierra
  // el job, así que no compite por el orden de la cola del chat.
  const discard = useMutation<Message, Error, Message>({
    mutationFn: (message: Message) => discardFailedMessage(chatId, message),
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

  function retryMessage(message: Message) {
    if (message.outbox_status !== 'failed' || message.id < 1) return
    retry.mutate(message)
  }

  function discardMessage(message: Message) {
    if (message.outbox_status !== 'failed' || message.id < 1) return
    discard.mutate(message)
  }

  return {
    ...mutation,
    error: mutation.error ?? retry.error ?? discard.error,
    retryMessage,
    discardMessage,
  }
}

export function useSendAudio(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, AudioPayload, OptimisticContext>({
    mutationKey: messageKeys.sending(chatId),
    mutationFn: payload => orderedRequest(chatId, () => sendAudio(chatId, payload)),
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey: messageKeys.thread(chatId) })
      return appendOptimisticMessages(queryClient, chatId, [{
        content: null,
        message_type: 'audio',
        media_url: `data:${payload.contentType};base64,${payload.dataBase64}`,
        reply_to: payload.replyTo,
      }])
    },
    onSuccess: (message, _payload, context) => reconcileOptimisticMessages(queryClient, chatId, context, [message]),
    onError: (_error, _payload, context) => removeOptimisticMessages(queryClient, chatId, context),
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })
}

export function useSendMedia(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, MediaPayload, OptimisticContext>({
    mutationKey: messageKeys.sending(chatId),
    mutationFn: payload => orderedRequest(chatId, () => sendMedia(chatId, payload)),
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey: messageKeys.thread(chatId) })
      const messageType: MessageType = payload.contentType.startsWith('image/') ? 'image'
        : payload.contentType.startsWith('video/') ? 'video'
          : payload.contentType.startsWith('audio/') ? 'audio' : 'document'
      // Repite acá lo que arma media_message_fields en el backend: si el
      // mensaje real ya trae album_id en el payload, el optimista también,
      // para que la grilla no "salte" al confirmarse el envío.
      const mediaPayload: { filename?: string; album_id?: string } =
        messageType === 'document' ? { filename: payload.filename ?? 'Archivo' } : {}
      if (payload.albumId) mediaPayload.album_id = payload.albumId
      return appendOptimisticMessages(queryClient, chatId, [{
        content: payload.caption || null,
        message_type: messageType,
        payload: Object.keys(mediaPayload).length ? mediaPayload : null,
        media_url: `data:${payload.contentType};base64,${payload.dataBase64}`,
        reply_to: payload.replyTo,
      }])
    },
    onSuccess: (message, _payload, context) => reconcileOptimisticMessages(queryClient, chatId, context, [message]),
    onError: (_error, _payload, context) => removeOptimisticMessages(queryClient, chatId, context),
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })
}

export function useSendTemplate(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message[], Error, SendTemplatePayload, OptimisticContext>({
    mutationKey: messageKeys.sending(chatId),
    mutationFn: (variables: SendTemplatePayload) => sendTemplate(chatId, variables),
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey: messageKeys.thread(chatId) })
      return appendOptimisticMessages(queryClient, chatId, payload.optimisticMessages)
    },
    onSuccess: (messages, _payload, context) => {
      reconcileOptimisticMessages(queryClient, chatId, context, messages)
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
    },
    onError: (_error, _payload, context) => removeOptimisticMessages(queryClient, chatId, context),
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })
}

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
      mutateMessageCache(queryClient, chatId, current => current.id === message.id ? message : current)
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
      mutateMessageCache(queryClient, chatId, current => current.id === message.id ? message : current)
      void queryClient.invalidateQueries({ queryKey: messageKeys.pinned(chatId) })
    },
  })
}

export function useUnpinMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, number>({
    mutationFn: (messageId: number) => unpinMessage(chatId, messageId),
    onSuccess: message => {
      mutateMessageCache(queryClient, chatId, current => current.id === message.id ? message : current)
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
      void queryClient.invalidateQueries({ queryKey: chatKeys.all })
      for (const target of targetChatIds) {
        void queryClient.invalidateQueries({ queryKey: messageKeys.thread(target) })
      }
    },
  })
}

export function useSendSticker(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, StickerPayload, OptimisticContext>({
    mutationKey: messageKeys.sending(chatId),
    mutationFn: payload => orderedRequest(chatId, () => sendSticker(chatId, payload)),
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey: messageKeys.thread(chatId) })
      return appendOptimisticMessages(queryClient, chatId, [{
        content: null,
        message_type: 'sticker',
        media_url: payload.mediaUrl,
      }])
    },
    onSuccess: (message, _payload, context) => reconcileOptimisticMessages(queryClient, chatId, context, [message]),
    onError: (_error, _payload, context) => removeOptimisticMessages(queryClient, chatId, context),
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })
}

export function useSendLocation(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, LocationPayload, OptimisticContext>({
    mutationKey: messageKeys.sending(chatId),
    mutationFn: payload => orderedRequest(chatId, () => sendLocation(chatId, payload)),
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey: messageKeys.thread(chatId) })
      return appendOptimisticMessages(queryClient, chatId, [{
        content: null,
        message_type: 'location',
        // Misma forma que el cuerpo de Meta que devolverá el backend.
        provider_payload: { location: { latitude: payload.latitude, longitude: payload.longitude } },
        reply_to: payload.replyTo,
      }])
    },
    onSuccess: (message, _payload, context) => reconcileOptimisticMessages(queryClient, chatId, context, [message]),
    onError: (_error, _payload, context) => removeOptimisticMessages(queryClient, chatId, context),
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })
}

export type { ContactShareInput } from '../types'

/** Comparte uno o varios contactos dentro de un único mensaje nativo. */
export function useSendContacts(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, ContactsPayload, OptimisticContext>({
    mutationKey: messageKeys.sending(chatId),
    mutationFn: payload => orderedRequest(chatId, () => sendContacts(chatId, payload)),
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey: messageKeys.thread(chatId) })
      return appendOptimisticMessages(queryClient, chatId, [{
        content: null,
        message_type: 'contacts',
        provider_payload: {
          contacts: payload.contacts.map(contact => ({
            name: { formatted_name: contact.fullName },
            phones: [{ phone: contact.phoneNumber }],
          })),
        },
        reply_to: payload.replyTo,
      }])
    },
    onSuccess: (message, _payload, context) => reconcileOptimisticMessages(queryClient, chatId, context, [message]),
    onError: (_error, _payload, context) => removeOptimisticMessages(queryClient, chatId, context),
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })
}

/** Manda un objeto `interactive` de Meta tal cual (producto, catálogo, Flow,
 * permiso de llamada). El backend lo valida contra el contrato y contra lo
 * que la cuenta tiene habilitado antes de encolarlo. */
export function useSendInteractive(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, InteractivePayload, OptimisticContext>({
    mutationKey: messageKeys.sending(chatId),
    mutationFn: (variables: InteractivePayload) => sendInteractive(chatId, variables),
    onMutate: async ({ interactive, replyTo }) => {
      await queryClient.cancelQueries({ queryKey: messageKeys.thread(chatId) })
      const body = interactive.body
      const text = body && typeof body === 'object' && !Array.isArray(body) && typeof body.text === 'string' ? body.text : null
      return appendOptimisticMessages(queryClient, chatId, [{
        content: text,
        message_type: 'interactive',
        message_subtype: typeof interactive.type === 'string' ? interactive.type : null,
        provider_payload: { interactive },
        reply_to: replyTo,
      }])
    },
    onSuccess: (message, _payload, context) => reconcileOptimisticMessages(queryClient, chatId, context, [message]),
    onError: (_error, _payload, context) => removeOptimisticMessages(queryClient, chatId, context),
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })
}
