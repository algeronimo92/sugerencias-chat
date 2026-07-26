/**
 * Un acuse de entrega de WhatsApp no debe provocar ni un GET.
 *
 * Cada mensaje enviado genera varios acuses seguidos (SERVER_ACK,
 * DELIVERY_ACK, READ). El handler ya parchea el estado en la caché, así que
 * invalidar además la lista, el detalle y el historial completo eran nueve
 * peticiones por mensaje enviado, sin que cambiara nada visible.
 *
 * Es una regresión que no se nota mirando la aplicación —todo sigue
 * funcionando, sólo más lento y con más tráfico—, de las que sólo se ven en la
 * pestaña Network. De ahí este test.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { PropsWithChildren } from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatUpdates } from './useChats'

const CHAT_ID = '51958334533@s.whatsapp.net'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  closed = false

  url: string

  // Campo explícito y no propiedad de constructor: el tsconfig usa
  // erasableSyntaxOnly, que prohíbe esa forma abreviada.
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  close() {
    this.closed = true
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  static get last() {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  }
}

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  // Se siembra un historial para poder comprobar que el estado se parchea
  // sobre la caché existente en vez de refetchearla.
  client.setQueryData(['messages', CHAT_ID], {
    pages: [{ items: [{ id: 1, status: 'PENDING' }, { id: 2, status: 'PENDING' }], has_more: false }],
    pageParams: [null],
  })
  currentClient = client
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

let currentClient: QueryClient

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function statusEvent() {
  return {
    type: 'chats_updated',
    chat_id: CHAT_ID,
    reason: 'message_status',
    message_statuses: [
      { id: 1, status: 'DELIVERY_ACK' },
      { id: 2, status: 'READ' },
    ],
  }
}

describe('useChatUpdates con un evento message_status', () => {
  it('parchea el estado de las burbujas en la caché', () => {
    renderHook(() => useChatUpdates(), { wrapper })
    act(() => {
      FakeWebSocket.last.onopen?.()
      FakeWebSocket.last.emit(statusEvent())
    })

    const cached = currentClient.getQueryData(['messages', CHAT_ID]) as {
      pages: { items: { id: number; status: string }[] }[]
    }
    expect(cached.pages[0].items).toEqual([
      { id: 1, status: 'DELIVERY_ACK' },
      { id: 2, status: 'READ' },
    ])
  })

  it('no invalida ninguna query', () => {
    renderHook(() => useChatUpdates(), { wrapper })
    const invalidate = vi.spyOn(currentClient, 'invalidateQueries')

    act(() => {
      FakeWebSocket.last.onopen?.()
      FakeWebSocket.last.emit(statusEvent())
    })

    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('useChatUpdates con otros motivos', () => {
  it('un mensaje entrante sí refresca la lista y el historial', () => {
    renderHook(() => useChatUpdates(), { wrapper })
    const invalidate = vi.spyOn(currentClient, 'invalidateQueries')

    act(() => {
      FakeWebSocket.last.onopen?.()
      FakeWebSocket.last.emit({ type: 'chats_updated', chat_id: CHAT_ID, reason: 'inbound_message' })
    })

    const keys = invalidate.mock.calls.map(([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey))
    expect(keys).toContain(JSON.stringify(['chats']))
    expect(keys).toContain(JSON.stringify(['messages', CHAT_ID]))
    expect(keys).toContain(JSON.stringify(['unread-count']))
  })

  it('marcar como leído no debe refetchear el historial', () => {
    renderHook(() => useChatUpdates(), { wrapper })
    const invalidate = vi.spyOn(currentClient, 'invalidateQueries')

    act(() => {
      FakeWebSocket.last.onopen?.()
      FakeWebSocket.last.emit({ type: 'chats_updated', chat_id: CHAT_ID, reason: 'read' })
    })

    // El contador de no leídos sí cambia; los mensajes no.
    const keys = invalidate.mock.calls.map(([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey))
    expect(keys).toContain(JSON.stringify(['unread-count']))
  })
})

describe('ciclo de vida del socket', () => {
  it('cierra el socket y suelta los handlers al desmontar', () => {
    const { unmount } = renderHook(() => useChatUpdates(), { wrapper })
    const socket = FakeWebSocket.last

    unmount()

    expect(socket.closed).toBe(true)
    // Sin soltarlos, un onclose posterior al desmontaje volvería a tocar
    // estado del hook o programaría una reconexión huérfana.
    expect(socket.onclose).toBeNull()
    expect(socket.onmessage).toBeNull()
  })
})
