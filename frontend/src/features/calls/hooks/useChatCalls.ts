import { useQuery } from '@tanstack/react-query'
import { fetchChatCalls } from '../api'
import { callKeys } from '../keys'

/** Las llamadas de un chat, para intercalarlas en el hilo. */
export function useChatCalls(chatId: string | null | undefined) {
  return useQuery({
    queryKey: callKeys.chat(chatId ?? ''),
    queryFn: () => fetchChatCalls(chatId as string),
    enabled: Boolean(chatId),
  })
}
