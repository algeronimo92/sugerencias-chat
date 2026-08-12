import axios from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { AuthSession, AuthUser, PinStatus } from '../types'

/** Largo del PIN de acceso rápido. Tiene que coincidir con PIN_LENGTH del
 *  backend (services/session_service.py), que es quien lo valida de verdad. */
export const PIN_LENGTH = 4

async function fetchMe(): Promise<AuthUser | null> {
  try {
    const { data } = await client.get<AuthUser>('/api/auth/me')
    return data
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) return null
    throw err
  }
}

export function useMe() {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchMe,
    staleTime: 5 * 60_000,
    retry: false,
  })
}

interface LoginPayload {
  email: string
  password: string
  remember_device: boolean
}

async function login(payload: LoginPayload): Promise<AuthUser> {
  const { data } = await client.post<AuthUser>('/api/auth/login', payload)
  return data
}

function useSuccessfulLogin() {
  const queryClient = useQueryClient()
  return (user: AuthUser) => {
    queryClient.setQueryData(['auth', 'me'], user)
    void queryClient.invalidateQueries({ queryKey: ['auth', 'pin-status'] })
  }
}

export function useLogin() {
  const onSuccess = useSuccessfulLogin()
  return useMutation({ mutationFn: login, onSuccess })
}

export function usePinLogin() {
  const onSuccess = useSuccessfulLogin()
  return useMutation({
    mutationFn: async (pin: string) => (
      await client.post<AuthUser>('/api/auth/pin/login', { pin })
    ).data,
    onSuccess,
  })
}

export function usePinStatus() {
  return useQuery({
    queryKey: ['auth', 'pin-status'],
    queryFn: async () => (await client.get<PinStatus>('/api/auth/pin/status')).data,
    staleTime: 30_000,
    retry: false,
  })
}

export function useSetupPin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ pin, currentPassword }: { pin: string; currentPassword: string }) => (
      await client.post<PinStatus>('/api/auth/pin/setup', { pin, current_password: currentPassword })
    ).data,
    onSuccess: (status) => queryClient.setQueryData(['auth', 'pin-status'], status),
  })
}

export function useRemovePin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => { await client.delete('/api/auth/pin') },
    onSuccess: () => queryClient.setQueryData(['auth', 'pin-status'], { available: false, locked_seconds: 0 }),
  })
}

export function useSessions(enabled = true) {
  return useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: async () => (await client.get<AuthSession[]>('/api/auth/sessions')).data,
    enabled,
  })
}

export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (sessionId: string) => { await client.delete(`/api/auth/sessions/${sessionId}`) },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
  })
}

async function logout(): Promise<void> {
  await client.post('/api/auth/logout')
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear()
      queryClient.setQueryData(['auth', 'me'], null)
    },
  })
}

export function useLogoutAll() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => { await client.post('/api/auth/logout-all') },
    onSuccess: () => {
      queryClient.clear()
      queryClient.setQueryData(['auth', 'me'], null)
    },
  })
}
