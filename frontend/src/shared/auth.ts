import { useQuery } from '@tanstack/react-query'

import client from './http/client'
import type { ApiResponse } from './http/contract'
import { asApiError } from './http/errors'
import { ME_QUERY_KEY } from './queryClient'
import type { AuthUser } from './types'

async function fetchMe(): Promise<AuthUser | null> {
  try {
    const { data } = await client.get<ApiResponse<'/api/auth/me', 'get'>>('/api/auth/me')
    return data
  } catch (error) {
    if (asApiError(error)?.status === 401) return null
    throw error
  }
}

export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    staleTime: 5 * 60_000,
    retry: false,
  })
}
