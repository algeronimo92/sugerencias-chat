import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import client from '../api/client'
import type { JsonObject, Message, MessageReaction, MessageType } from '../types'

interface MessagePage {
  items: Message[]
  has_more: boolean
}

type MessageCursor = { cursorTs: string; cursorId: number } | null

async function fetchMessages(chatId: string, cursor: MessageCursor, untilId?: number | null): Promise<MessagePage> {
  const params: Record<string, string | number> = {}
  if (cursor) {
    params.cursor_ts = cursor.cursorTs
    params.cursor_id = cursor.cursorId
  } else if (untilId) {
    // Primera página al abrir desde un resultado de búsqueda por mensaje:
    // el backend la agranda hasta incluir el mensaje matcheado.
    params.until_id = untilId
  }
  const { data } = await client.get<MessagePage>(`/api/chats/${encodeURIComponent(chatId)}/messages`, { params })
  return data
}

// untilId no forma parte de la queryKey a propósito: los updates optimistas
// de useSendMessage escriben sobre ['messages', chatId] exacto. Solo influye
// en cómo se pide la primera página cuando la cache está vacía; si el chat ya
// estaba cacheado sin el mensaje buscado, ChatThread pagina hacia atrás hasta
// encontrarlo.
export function useMessages(chatId: string | null, untilId?: number | null) {
  return useInfiniteQuery({
    queryKey: ['messages', chatId],
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
    // Respaldo del WebSocket: algunas instalaciones de n8n actualizan el
    // estado directamente en PostgreSQL sin llamar al webhook de la app.
    // Solo la conversación visible se consulta y el navegador pausa este
    // intervalo cuando la pestaña queda en segundo plano.
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    retry: false,
  })
}

let nextOptimisticMessageId = -1
let lastOptimisticTimestamp = 0
const requestTails = new Map<string, Promise<void>>()

/** Mensaje al que se está respondiendo. El backend solo necesita el id; el
 * resto viaja para poder pintar la cita antes de que conteste. */
export interface ReplyTarget {
  id: number
  sender: string
  content: string | null
}

export interface OptimisticMessageDraft {
  content: string | null
  media_url?: string | null
  reply_to?: ReplyTarget | null
  message_type?: MessageType | null
  payload?: JsonObject | null
}

interface OptimisticContext {
  optimisticIds: number[]
}

/** Los requests se serializan por chat, pero todas las burbujas aparecen de
 * inmediato. Así se conserva el orden de pulsación incluso si una carga de
 * archivo tarda más que el texto que se escribió después. */
function orderedRequest<T>(chatId: string, request: () => Promise<T>): Promise<T> {
  const previous = requestTails.get(chatId) ?? Promise.resolve()
  const current = previous.then(request)
  const tail = current.then(() => undefined, () => undefined)
  requestTails.set(chatId, tail)
  void tail.finally(() => {
    if (requestTails.get(chatId) === tail) requestTails.delete(chatId)
  })
  return current
}

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
    status: 'PENDING',
    message_type: draft.message_type ?? null,
    analysis: null,
    payload: draft.payload ?? null,
    quoted_message_id: draft.reply_to?.id ?? null,
    quoted_sender: draft.reply_to?.sender ?? null,
    quoted_content: draft.reply_to?.content ?? null,
  }
}

function mutateMessageCache(
  queryClient: ReturnType<typeof useQueryClient>,
  chatId: string,
  update: (message: Message) => Message | null,
) {
  queryClient.setQueryData<InfiniteData<MessagePage>>(['messages', chatId], current => {
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
  queryClient.setQueryData<InfiniteData<MessagePage>>(['messages', chatId], current => {
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
  queryClient.setQueryData<InfiniteData<MessagePage>>(['messages', chatId], current => {
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
    if (queryClient.isMutating({ mutationKey: ['send-message', chatId] }) === 0) {
      void queryClient.invalidateQueries({ queryKey: ['messages', chatId] })
    }
  }, 0)
}

export interface TextPayload {
  text: string
  replyTo?: ReplyTarget | null
}

export function useSendMessage(chatId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation<Message, Error, TextPayload, OptimisticContext>({
    mutationKey: ['send-message', chatId],
    mutationFn: ({ text, replyTo }) => orderedRequest(chatId, async () => (
      await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
        text,
        reply_to_message_id: replyTo?.id ?? null,
      })
    ).data),
    onMutate: async ({ text, replyTo }) => {
      await queryClient.cancelQueries({ queryKey: ['messages', chatId] })
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
    mutationKey: ['send-message', chatId],
    mutationFn: message => orderedRequest(chatId, async () => (
      await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/messages/${message.id}/retry`)
    ).data),
    onMutate: async message => {
      await queryClient.cancelQueries({ queryKey: ['messages', chatId] })
      mutateMessageCache(queryClient, chatId, current => current.id === message.id
        ? { ...current, status: 'PENDING', wa_message_id: null }
        : current)
    },
    onSuccess: message => {
      mutateMessageCache(queryClient, chatId, current => current.id === message.id ? message : current)
    },
    onError: (_error, message) => {
      mutateMessageCache(queryClient, chatId, current => current.id === message.id
        ? { ...current, status: 'FAILED' }
        : current)
    },
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })

  function retryMessage(message: Message) {
    if (message.status !== 'FAILED' || message.id < 1) return
    retry.mutate(message)
  }

  return { ...mutation, error: mutation.error ?? retry.error, retryMessage }
}

interface AudioPayload {
  contentType: string
  dataBase64: string
  replyTo?: ReplyTarget | null
}

async function sendAudio(chatId: string, { contentType, dataBase64, replyTo }: AudioPayload): Promise<Message> {
  const { data } = await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/audio`, {
    content_type: contentType,
    data_base64: dataBase64,
    reply_to_message_id: replyTo?.id ?? null,
  })
  return data
}

export function useSendAudio(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, AudioPayload, OptimisticContext>({
    mutationKey: ['send-message', chatId],
    mutationFn: payload => orderedRequest(chatId, () => sendAudio(chatId, payload)),
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey: ['messages', chatId] })
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

interface MediaPayload {
  contentType: string
  dataBase64: string
  filename?: string
  /** Epígrafe opcional (el texto debajo de la imagen/video), como en WhatsApp. */
  caption?: string
  replyTo?: ReplyTarget | null
}

async function sendMedia(chatId: string, { contentType, dataBase64, filename, caption, replyTo }: MediaPayload): Promise<Message> {
  const { data } = await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/media`, {
    content_type: contentType,
    data_base64: dataBase64,
    filename,
    caption: caption || null,
    reply_to_message_id: replyTo?.id ?? null,
  })
  return data
}

export function useSendMedia(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, MediaPayload, OptimisticContext>({
    mutationKey: ['send-message', chatId],
    mutationFn: payload => orderedRequest(chatId, () => sendMedia(chatId, payload)),
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey: ['messages', chatId] })
      const messageType: MessageType = payload.contentType.startsWith('image/') ? 'image'
        : payload.contentType.startsWith('video/') ? 'video'
          : payload.contentType.startsWith('audio/') ? 'audio' : 'document'
      return appendOptimisticMessages(queryClient, chatId, [{
        content: payload.caption || null,
        message_type: messageType,
        payload: messageType === 'document' ? { filename: payload.filename ?? 'Archivo' } : null,
        media_url: `data:${payload.contentType};base64,${payload.dataBase64}`,
        reply_to: payload.replyTo,
      }])
    },
    onSuccess: (message, _payload, context) => reconcileOptimisticMessages(queryClient, chatId, context, [message]),
    onError: (_error, _payload, context) => removeOptimisticMessages(queryClient, chatId, context),
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })
}

interface SendTemplatePayload {
  templateId: number
  text: string
  parameters?: string[]
  optimisticMessages: OptimisticMessageDraft[]
}

export function useSendTemplate(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message[], Error, SendTemplatePayload, OptimisticContext>({
    mutationKey: ['send-message', chatId],
    mutationFn: ({ templateId, text, parameters = [] }) => orderedRequest(chatId, async () =>
      (await client.post<Message[]>(`/api/chats/${encodeURIComponent(chatId)}/templates/${templateId}`, { text, parameters })).data),
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey: ['messages', chatId] })
      return appendOptimisticMessages(queryClient, chatId, payload.optimisticMessages)
    },
    onSuccess: (messages, _payload, context) => {
      reconcileOptimisticMessages(queryClient, chatId, context, messages)
      queryClient.invalidateQueries({ queryKey: ['templates'] })
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

interface ReactionPayload {
  messageId: number
  emoji: string
}

export function useReactToMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, ReactionPayload, { previous: MessageReaction[] | null }>({
    mutationFn: async ({ messageId, emoji }) =>
      (await client.post<Message>(
        `/api/chats/${encodeURIComponent(chatId)}/messages/${messageId}/reaction`,
        { emoji },
      )).data,
    onMutate: async ({ messageId, emoji }) => {
      await queryClient.cancelQueries({ queryKey: ['messages', chatId] })
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

interface EditPayload {
  messageId: number
  text: string
}

/** Reescribe el texto de un mensaje ya enviado (el "Editar" de WhatsApp).
 *
 * Sin update optimista a propósito: el backend rechaza la edición fuera de los
 * 15 minutos, sobre adjuntos y sobre mensajes ajenos, y pintar el texto nuevo
 * antes de esa respuesta mostraría una corrección que el cliente nunca vio. */
export function useEditMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, EditPayload>({
    mutationFn: async ({ messageId, text }) =>
      (await client.patch<Message>(
        `/api/chats/${encodeURIComponent(chatId)}/messages/${messageId}`,
        { text },
      )).data,
    onSuccess: message => {
      mutateMessageCache(queryClient, chatId, current => current.id === message.id ? message : current)
      // El preview de la lista muestra el último mensaje: si era este, cambió.
      void queryClient.invalidateQueries({ queryKey: ['chats'] })
    },
  })
}

/** Elimina para todos un mensaje ya enviado. La burbuja no desaparece: queda
 * la lápida ("Se eliminó este mensaje"), igual que en WhatsApp. */
export function useDeleteMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, number>({
    mutationFn: async messageId =>
      (await client.delete<Message>(
        `/api/chats/${encodeURIComponent(chatId)}/messages/${messageId}`,
      )).data,
    onSuccess: message => {
      mutateMessageCache(queryClient, chatId, current => current.id === message.id ? message : current)
      void queryClient.invalidateQueries({ queryKey: ['chats'] })
    },
  })
}

interface StickerPayload {
  assetId: number
  /** URL del asset, para pintar la burbuja optimista antes de la respuesta. */
  mediaUrl: string
}

async function sendSticker(chatId: string, { assetId }: StickerPayload): Promise<Message> {
  const { data } = await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/sticker`, {
    asset_id: assetId,
  })
  return data
}

export function useSendSticker(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, StickerPayload, OptimisticContext>({
    mutationKey: ['send-message', chatId],
    mutationFn: payload => orderedRequest(chatId, () => sendSticker(chatId, payload)),
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey: ['messages', chatId] })
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

interface LocationPayload {
  latitude: number
  longitude: number
  replyTo?: ReplyTarget | null
}

async function sendLocation(chatId: string, { latitude, longitude, replyTo }: LocationPayload): Promise<Message> {
  const { data } = await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/location`, {
    latitude,
    longitude,
    reply_to_message_id: replyTo?.id ?? null,
  })
  return data
}

export function useSendLocation(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, LocationPayload, OptimisticContext>({
    mutationKey: ['send-message', chatId],
    mutationFn: payload => orderedRequest(chatId, () => sendLocation(chatId, payload)),
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey: ['messages', chatId] })
      return appendOptimisticMessages(queryClient, chatId, [{
        content: null,
        message_type: 'location',
        payload: { latitude: payload.latitude, longitude: payload.longitude },
        reply_to: payload.replyTo,
      }])
    },
    onSuccess: (message, _payload, context) => reconcileOptimisticMessages(queryClient, chatId, context, [message]),
    onError: (_error, _payload, context) => removeOptimisticMessages(queryClient, chatId, context),
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })
}
