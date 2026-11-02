import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createUser, fetchUsers, resendInvitation, fetchSellers, sendPasswordReset, updateUser } from '../api'
import { userKeys } from '../keys'

export function useSellers({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: userKeys.sellers,
    queryFn: fetchSellers,
    enabled,
    staleTime: 60_000,
  })
}

export function useUsers(enabled: boolean) {
  return useQuery({
    queryKey: userKeys.all,
    queryFn: fetchUsers,
    enabled,
  })
}

export function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  })
}

export function useUpdateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  })
}

export function useSendPasswordReset() {
  return useMutation({
    mutationFn: sendPasswordReset,
  })
}

export function useResendInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: resendInvitation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  })
}
