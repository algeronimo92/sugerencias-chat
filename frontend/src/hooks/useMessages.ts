import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { Message } from '../types'

interface MessagePage {
  items: Message[]
  has_more: boolean
}

type MessageCursor = { cursorTs: string; cursorId: number } | null

async function fetchMessages(chatId: string, cursor: MessageCursor): Promise<MessagePage> {
  const params: Record<string, string | number> = {}
  if (cursor) {
    params.cursor_ts = cursor.cursorTs
    params.cursor_id = cursor.cursorId
  }
  const { data } = await client.get<MessagePage>(`/api/chats/${encodeURIComponent(chatId)}/messages`, { params })
  return data
}

export function useMessages(chatId: string | null) {
  return useInfiniteQuery({
    queryKey: ['messages', chatId],
    queryFn: ({ pageParam }) => fetchMessages(chatId as string, pageParam),
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

export function useSendMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (text: string) => sendMessage(chatId, text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] })
    },
  })
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
    mutationFn: async ({ templateId, text }: { templateId: number; text: string }) =>
      (await client.post<Message[]>(`/api/chats/${encodeURIComponent(chatId)}/templates/${templateId}`, { text })).data,
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
