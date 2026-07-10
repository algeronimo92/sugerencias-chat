import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { AppUser, UserRole } from '../types'

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
  password: string
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

interface ResetPasswordPayload {
  id: number
  newPassword: string
}

async function resetPassword({ id, newPassword }: ResetPasswordPayload): Promise<void> {
  await client.post(`/api/users/${id}/reset-password`, { new_password: newPassword })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: resetPassword,
  })
}
