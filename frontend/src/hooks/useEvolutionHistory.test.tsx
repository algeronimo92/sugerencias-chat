/**
 * El historial de WhatsApp se lee de Evolution, no de la base: cada página
 * cuesta varias llamadas a la instancia. Por eso no se pide solo, se pide una
 * sola vez por tramo, y se corta apenas Evolution dice que no hay más.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import client from '../api/client'
import { useEvolutionHistory } from './useEvolutionHistory'

const CHAT_ID = '7b08f4d9-855f-4718-b95f-9c021da52f77'
const OLDEST_DB_MESSAGE = '2024-05-01T10:00:00.000000Z'

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function historyItem(waMessageId: string) {
  return {
    wa_message_id: waMessageId,
    sender: 'cliente' as const,
    content: `mensaje ${waMessageId}`,
    sent_at: '2024-04-01T09:00:00.000000Z',
  }
}

let get: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  get = vi.spyOn(client, 'get')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useEvolutionHistory', () => {
  it('no consulta Evolution hasta que se lo pide a mano', async () => {
    renderHook(() => useEvolutionHistory(CHAT_ID, OLDEST_DB_MESSAGE, false), { wrapper })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(get).not.toHaveBeenCalled()
  })

  it('deja que el backend elija por dónde empezar y le pasa el límite del registro', async () => {
    get.mockResolvedValue({ data: { items: [historyItem('A')], has_more: false, next_page: null } })

    const { result } = renderHook(
      () => useEvolutionHistory(CHAT_ID, OLDEST_DB_MESSAGE, true),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(get).toHaveBeenCalledWith(
      `/api/chats/${encodeURIComponent(CHAT_ID)}/history`,
      { params: { before_ts: OLDEST_DB_MESSAGE } },
    )
    expect(result.current.hasNextPage).toBe(false)
  })

  it('sigue paginando con el cursor que devuelve Evolution', async () => {
    get.mockResolvedValueOnce({
      data: { items: [historyItem('A')], has_more: true, next_page: 7 },
    })
    get.mockResolvedValueOnce({
      data: { items: [historyItem('B')], has_more: false, next_page: null },
    })

    const { result } = renderHook(
      () => useEvolutionHistory(CHAT_ID, OLDEST_DB_MESSAGE, true),
      { wrapper },
    )

    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    await result.current.fetchNextPage()

    await waitFor(() => expect(result.current.hasNextPage).toBe(false))
    expect(get).toHaveBeenLastCalledWith(
      `/api/chats/${encodeURIComponent(CHAT_ID)}/history`,
      { params: { page: 7, before_ts: OLDEST_DB_MESSAGE } },
    )
  })
})
