import axios from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { AuthUser } from '../types'

async function fetchMe(): Promise<AuthUser | null> {
  try {
    const { data } = await client.get<AuthUser>('/api/auth/me')
    return data
  } catch (err) {
    // 401 significa "no hay sesión" — es el estado normal antes de loguearse,
    // no un error a mostrar.
    if (axios.isAxiosError(err) && err.response?.status === 401) return null
    throw err
  }
}

/** Única fuente de verdad de la sesión: null = no logueado, undefined = todavía cargando. */
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
}

async function login(payload: LoginPayload): Promise<AuthUser> {
  const { data } = await client.post<AuthUser>('/api/auth/login', payload)
  return data
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      queryClient.setQueryData(['auth', 'me'], user)
    },
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
      queryClient.setQueryData(['auth', 'me'], null)
      queryClient.clear()
    },
  })
}
