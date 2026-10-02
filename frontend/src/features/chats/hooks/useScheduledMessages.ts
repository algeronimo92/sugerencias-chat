import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { requestCancelScheduledMessage,requestCreateScheduledMessage,requestScheduledMessages } from '../api'



export function useScheduledMessages(chatId: string) {
  return useQuery({
    queryKey: ['scheduled-messages', chatId],
    queryFn: requestScheduledMessages(chatId),
    staleTime: 15_000,
  })
}


export function useCreateScheduledMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestCreateScheduledMessage(chatId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scheduled-messages', chatId] })
    },
  })
}


export function useCancelScheduledMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestCancelScheduledMessage(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scheduled-messages', chatId] })
    },
  })
}
