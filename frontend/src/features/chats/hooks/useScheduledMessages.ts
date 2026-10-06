import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { cancelScheduledMessage,createScheduledMessage,fetchScheduledMessages } from '../api'



export function useScheduledMessages(chatId: string) {
  return useQuery({
    queryKey: ['scheduled-messages', chatId],
    queryFn: () => fetchScheduledMessages(chatId),
    staleTime: 15_000,
  })
}


export function useCreateScheduledMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { text: string; scheduledAt: string }) => createScheduledMessage(chatId, variables),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scheduled-messages', chatId] })
    },
  })
}


export function useCancelScheduledMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: cancelScheduledMessage,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scheduled-messages', chatId] })
    },
  })
}
