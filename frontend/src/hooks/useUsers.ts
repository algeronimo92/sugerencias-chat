import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { AppUser, SellerOption, UserRole } from '../types'

export function useSellers({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['sellers'],
    queryFn: async () => (await client.get<SellerOption[]>('/api/chats/sellers')).data,
    enabled,
    staleTime: 60_000,
  })
}

async function fetchUsers(): Promise<AppUser[]> {
  const { data } = await client.get<AppUser[]>('/api/users')
  return data
}

export function useUsers(enabled: boolean) {
  return useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
    enabled,
  })
}

interface CreateUserPayload {
  email: string
  name: string
  role: UserRole
}

async function createUser(payload: CreateUserPayload): Promise<AppUser> {
  const { data } = await client.post<AppUser>('/api/users', payload)
  return data
}

export function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })
}

interface UpdateUserPayload {
  id: number
  role?: UserRole
  is_active?: boolean
}

async function updateUser({ id, ...values }: UpdateUserPayload): Promise<AppUser> {
  const { data } = await client.patch<AppUser>(`/api/users/${id}`, values)
  return data
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
    mutationFn: async (id: number) => {
      await client.post(`/api/users/${id}/send-password-reset`)
    },
  })
}

export function useResendInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => (
      await client.post<AppUser>(`/api/users/${id}/resend-invitation`)
    ).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })
}
