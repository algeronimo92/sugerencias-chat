import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import client from '../api/client'
import type { Message } from '../types'

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

export interface OptimisticMessageDraft {
  content: string | null
  media_url?: string | null
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

export function useSendMessage(chatId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation<Message, Error, string, OptimisticContext>({
    mutationKey: ['send-message', chatId],
    mutationFn: text => orderedRequest(chatId, async () => (
      await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/messages`, { text })
    ).data),
    onMutate: async (text) => {
      await queryClient.cancelQueries({ queryKey: ['messages', chatId] })
      return appendOptimisticMessages(queryClient, chatId, [{ content: text }])
    },
    onSuccess: (message, _text, context) => {
      reconcileOptimisticMessages(queryClient, chatId, context, [message])
    },
    onError: (_error, _text, context) => {
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
}

async function sendAudio(chatId: string, { contentType, dataBase64 }: AudioPayload): Promise<Message> {
  const { data } = await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/audio`, {
    content_type: contentType,
    data_base64: dataBase64,
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
        content: '<audio></audio>',
        media_url: `data:${payload.contentType};base64,${payload.dataBase64}`,
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
}

async function sendMedia(chatId: string, { contentType, dataBase64, filename }: MediaPayload): Promise<Message> {
  const { data } = await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/media`, {
    content_type: contentType,
    data_base64: dataBase64,
    filename,
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
      const kind = payload.contentType.startsWith('image/') ? 'image'
        : payload.contentType.startsWith('video/') ? 'video'
          : payload.contentType.startsWith('audio/') ? 'audio' : 'other'
      const content = kind === 'other' ? `<other>${payload.filename ?? 'Archivo'}</other>` : `<${kind}></${kind}>`
      return appendOptimisticMessages(queryClient, chatId, [{
        content,
        media_url: `data:${payload.contentType};base64,${payload.dataBase64}`,
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

interface LocationPayload {
  latitude: number
  longitude: number
}

async function sendLocation(chatId: string, payload: LocationPayload): Promise<Message> {
  const { data } = await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/location`, payload)
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
        content: `<location>${payload.latitude},${payload.longitude}</location>`,
      }])
    },
    onSuccess: (message, _payload, context) => reconcileOptimisticMessages(queryClient, chatId, context, [message]),
    onError: (_error, _payload, context) => removeOptimisticMessages(queryClient, chatId, context),
    onSettled: () => refetchAfterLastSend(queryClient, chatId),
  })
}
