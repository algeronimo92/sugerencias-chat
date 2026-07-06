import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { Chat } from '../types'

async function fetchChats(search: string): Promise<Chat[]> {
  const { data } = await client.get<Chat[]>('/api/chats', {
    params: search ? { search } : undefined,
  })
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

export function useChats(search: string = '', options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['chats', search],
    queryFn: () => fetchChats(search),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
    // Respaldo por si el websocket se desconecta
    refetchInterval: 20_000,
  })
}
