import { useQuery } from '@tanstack/react-query'
import client from '../api/client'
import type { Chat } from '../types'

const LEAD_SEARCH_LIMIT = 12

export function useLeadSearch(term: string) {
  const search = term.trim()
  return useQuery({
    queryKey: ['lead-search', search],
    queryFn: async ({ signal }) => (
      await client.get<{ items: Chat[] }>('/api/chats', { params: { search }, signal })
    ).data.items.slice(0, LEAD_SEARCH_LIMIT),
    enabled: search.length > 0,
    staleTime: 30_000,
  })
}
