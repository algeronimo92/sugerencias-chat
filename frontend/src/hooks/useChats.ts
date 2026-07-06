import { useQuery } from '@tanstack/react-query'
import client from '../api/client'
import type { Chat } from '../types'

async function fetchChats(search: string): Promise<Chat[]> {
  const { data } = await client.get<Chat[]>('/api/chats', {
    params: search ? { search } : undefined,
  })
  return data
}

export function useChats(search: string = '') {
  return useQuery({
    queryKey: ['chats', search],
    queryFn: () => fetchChats(search),
    staleTime: 30_000,
  })
}
