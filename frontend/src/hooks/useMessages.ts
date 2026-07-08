import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { Message } from '../types'

async function fetchMessages(chatId: string): Promise<Message[]> {
  const { data } = await client.get<Message[]>(`/api/chats/${encodeURIComponent(chatId)}/messages`)
  return data
}

export function useMessages(chatId: string | null) {
  return useQuery({
    queryKey: ['messages', chatId],
    queryFn: () => fetchMessages(chatId as string),
    enabled: !!chatId,
    staleTime: 15_000,
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
