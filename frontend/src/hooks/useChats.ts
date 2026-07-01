import { useQuery } from '@tanstack/react-query'
import client from '../api/client'
import type { Chat } from '../types'

async function fetchChats(): Promise<Chat[]> {
  const { data } = await client.get<Chat[]>('/api/chats')
  return data
}

export function useChats() {
  return useQuery({
    queryKey: ['chats'],
    queryFn: fetchChats,
    staleTime: 30_000,
  })
}
