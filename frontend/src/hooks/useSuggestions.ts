import { useMutation } from '@tanstack/react-query'
import client from '../api/client'
import type { SuggestionResponse } from '../types'

interface Params {
  chat_id: string
  phone: string | null
}

async function fetchSuggestions(params: Params): Promise<SuggestionResponse> {
  const { data } = await client.post<SuggestionResponse>('/api/suggestions', params)
  return data
}

export function useSuggestions() {
  return useMutation({
    mutationFn: fetchSuggestions,
  })
}
