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
    retry: false,
  })
}

async function sendMessage(chatId: string, text: string): Promise<Message> {
  const { data } = await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/messages`, { text })
  return data
}

let nextOptimisticMessageId = -1

interface SendMessageContext {
  optimisticId: number
}

function updateMessageCache(
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

export function useSendMessage(chatId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation<Message, Error, string, SendMessageContext>({
    mutationKey: ['send-message', chatId],
    mutationFn: (text: string) => sendMessage(chatId, text),
    onMutate: async (text) => {
      await queryClient.cancelQueries({ queryKey: ['messages', chatId] })
      const optimisticId = nextOptimisticMessageId--
      const optimisticMessage: Message = {
        id: optimisticId,
        sender: 'vendedor',
        content: text,
        sent_at: new Date().toISOString(),
        media_url: null,
        wa_message_id: null,
        status: 'PENDING',
      }
      queryClient.setQueryData<InfiniteData<MessagePage>>(['messages', chatId], current => {
        if (!current) {
          return { pages: [{ items: [optimisticMessage], has_more: false }], pageParams: [null] }
        }
        const pages = [...current.pages]
        const newestPage = pages[0] ?? { items: [], has_more: false }
        pages[0] = { ...newestPage, items: [...newestPage.items, optimisticMessage] }
        return { ...current, pages }
      })
      return { optimisticId }
    },
    onSuccess: (message, _text, context) => {
      if (context) {
        updateMessageCache(queryClient, chatId, current => current.id === context.optimisticId ? message : current)
      }
      // La respuesta ya contiene el mensaje definitivo. No se invalida toda la
      // conversación aquí porque otro envío concurrente podría seguir en estado
      // optimista y un refetch lo quitaría temporalmente de la vista.
    },
    onError: (_error, _text, context) => {
      if (context) {
        updateMessageCache(queryClient, chatId, current => current.id === context.optimisticId
          ? { ...current, status: 'FAILED' }
          : current)
      }
    },
  })

  function retryMessage(message: Message) {
    if (message.status !== 'FAILED' || !message.content?.trim()) return
    updateMessageCache(queryClient, chatId, current => current.id === message.id ? null : current)
    mutation.mutate(message.content)
  }

  return { ...mutation, retryMessage }
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
  return useMutation({
    mutationFn: (payload: AudioPayload) => sendAudio(chatId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] })
    },
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
  return useMutation({
    mutationFn: (payload: MediaPayload) => sendMedia(chatId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] })
    },
  })
}

export function useSendTemplate(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ templateId, text, parameters = [] }: { templateId: number; text: string; parameters?: string[] }) =>
      (await client.post<Message[]>(`/api/chats/${encodeURIComponent(chatId)}/templates/${templateId}`, { text, parameters })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] })
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
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
  return useMutation({
    mutationFn: (payload: LocationPayload) => sendLocation(chatId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] })
    },
  })
}
