import { useEffect } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { Chat, LeadInput, LeadUpdateInput } from '../types'

interface ChatsPage {
  items: Chat[]
  has_more: boolean
}

/** Cursor de keyset: última fila de la página anterior (mismo orden que la consulta del backend). */
type PageParam = { cursorTs: string | null; cursorId: string } | null

async function fetchChatsPage(search: string, pageParam: PageParam): Promise<ChatsPage> {
  const params: Record<string, string> = {}
  if (search) params.search = search
  if (pageParam) {
    params.cursor_id = pageParam.cursorId
    if (pageParam.cursorTs) params.cursor_ts = pageParam.cursorTs
  }
  const { data } = await client.get<ChatsPage>('/api/chats', { params })
  return data
}

function chatsSocketUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
  return `${base.replace(/^http/, 'ws')}/ws/chats`
}

const RECONNECT_DELAY_MS = 3_000

/** Escucha el websocket del backend y refresca chats/mensajes en cuanto hay novedades. Llamar una sola vez. */
export function useChatUpdates() {
  const queryClient = useQueryClient()

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    function connect() {
      socket = new WebSocket(chatsSocketUrl())

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload.type === 'chats_updated') {
            queryClient.invalidateQueries({ queryKey: ['chats'] })
            // También refresca el hilo de mensajes abierto, si lo hay
            queryClient.invalidateQueries({ queryKey: ['messages'] })
          }
        } catch {
          // Ignora payloads que no sean JSON válido
        }
      }

      socket.onclose = () => {
        if (!stopped) {
          reconnectTimeout = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }
    }

    connect()

    return () => {
      stopped = true
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      socket?.close()
    }
  }, [queryClient])
}

/** Resuelve un único chat (por id vía el parámetro search) fuera de la lista paginada. */
export function useChats(search: string = '', options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['chats', 'lookup', search],
    queryFn: async () => (await fetchChatsPage(search, null)).items,
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
    // Respaldo por si el websocket se desconecta
    refetchInterval: 20_000,
  })
}

/** Lista de leads con scroll infinito, paginada por cursor. */
export function useInfiniteChats(search: string = '') {
  return useInfiniteQuery({
    queryKey: ['chats', 'list', search],
    queryFn: ({ pageParam }) => fetchChatsPage(search, pageParam as PageParam),
    initialPageParam: null as PageParam,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more || lastPage.items.length === 0) return undefined
      const last = lastPage.items[lastPage.items.length - 1]
      return { cursorTs: last.timestamp, cursorId: last.chat_id }
    },
    staleTime: 30_000,
    // Respaldo por si el websocket se desconecta
    refetchInterval: 20_000,
    // Sin esto, los 3 reintentos automáticos de React Query absorben el
    // error antes de que isFetchNextPageError llegue a ser true, y el botón
    // "Reintentar" de la UI nunca se muestra.
    retry: false,
  })
}

async function createLead(payload: LeadInput): Promise<Chat> {
  const { data } = await client.post<Chat>('/api/chats', payload)
  return data
}

export function useCreateLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createLead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
    },
  })
}

async function updateLead(chatId: string, payload: LeadUpdateInput): Promise<Chat> {
  const { data } = await client.patch<Chat>(`/api/chats/${encodeURIComponent(chatId)}`, payload)
  return data
}

export function useUpdateLead(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: LeadUpdateInput) => updateLead(chatId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
    },
  })
}
