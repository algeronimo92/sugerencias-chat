import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { createUser,fetchUsers,requestResendInvitation,requestSellers,requestSendPasswordReset,updateUser } from '../api'

export function useSellers({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['sellers'],
    queryFn: requestSellers(),
    enabled,
    staleTime: 60_000,
  })
}



export function useUsers(enabled: boolean) {
  return useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
    enabled,
  })
}





export function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })
}





export function useUpdateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })
}

export function useSendPasswordReset() {
  return useMutation({
    mutationFn: requestSendPasswordReset(),
  })
}

export function useResendInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestResendInvitation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })
}
