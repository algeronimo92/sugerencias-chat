/**
 * jsdom no implementa Push API: sin `navigator.serviceWorker` ni
 * `window.PushManager`, el hook tiene que degradarse solo (no tirar, no
 * llamar al backend). Cuando sí están disponibles (simulados acá con
 * dobles), cubre el viaje completo: pedir la clave VAPID, suscribirse con
 * ella convertida a `Uint8Array`, avisar al backend, y lo mismo a la
 * inversa al desuscribirse.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import client from '../api/client'
import { usePushSubscription } from './usePushSubscription'

// Clave de ejemplo en base64url (con `-`/`_` y sin padding), como la
// devolvería el endpoint /api/push/vapid-public-key.
const VAPID_KEY = 'BNbxGYNMhEIi9r5UDzVLtT9x_Sqi6oCEhpNXVw6D-3ZaHJb2G8mMxeuGArQvzZfHfN2AqhbP4Uy9OhwzQow0rEc'

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function fakeSubscription(endpoint: string) {
  return {
    endpoint,
    unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }),
  }
}

describe('usePushSubscription sin soporte de Push en el navegador', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no rompe: queda sin suscribir y subscribe/unsubscribe son no-ops', async () => {
    const post = vi.spyOn(client, 'post')
    const { result } = renderHook(() => usePushSubscription(), { wrapper })

    expect(result.current.subscribed).toBe(false)
    await act(async () => {
      await result.current.subscribe()
      await result.current.unsubscribe()
    })

    expect(result.current.subscribed).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })
})

describe('usePushSubscription con soporte de Push', () => {
  let getSubscription: ReturnType<typeof vi.fn>
  let subscribeMock: ReturnType<typeof vi.fn>
  let get: ReturnType<typeof vi.spyOn>
  let post: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    get = vi.spyOn(client, 'get').mockResolvedValue({ data: { public_key: VAPID_KEY } })
    post = vi.spyOn(client, 'post').mockResolvedValue({ data: {} })
    getSubscription = vi.fn().mockResolvedValue(null)
    subscribeMock = vi.fn().mockResolvedValue(fakeSubscription('https://push.example/abc'))

    vi.stubGlobal('PushManager', class {})
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve({ pushManager: { getSubscription, subscribe: subscribeMock } }) },
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })

  it('se suscribe con la clave VAPID convertida y avisa al backend', async () => {
    const { result } = renderHook(() => usePushSubscription(), { wrapper })

    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/push/vapid-public-key'))

    // subscribe() no hace nada mientras la query de la clave VAPID sigue en
    // vuelo (evita suscribirse sin `applicationServerKey`); waitFor
    // reintenta hasta que ese fetch resuelva y el hook la tenga disponible.
    await waitFor(async () => {
      await act(async () => {
        await result.current.subscribe()
      })
      expect(subscribeMock).toHaveBeenCalled()
    })

    expect(subscribeMock).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    })
    expect(post).toHaveBeenCalledWith('/api/push/subscribe', {
      endpoint: 'https://push.example/abc',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    })
    expect(result.current.subscribed).toBe(true)
  })

  it('detecta al montar que ya había una suscripción activa', async () => {
    getSubscription.mockResolvedValue(fakeSubscription('https://push.example/ya-existe'))
    const { result } = renderHook(() => usePushSubscription(), { wrapper })

    await waitFor(() => expect(result.current.subscribed).toBe(true))
  })

  it('se desuscribe y avisa al backend con el endpoint', async () => {
    const subscription = fakeSubscription('https://push.example/xyz')
    getSubscription.mockResolvedValue(subscription)
    const { result } = renderHook(() => usePushSubscription(), { wrapper })
    await waitFor(() => expect(result.current.subscribed).toBe(true))

    await act(async () => {
      await result.current.unsubscribe()
    })

    expect(subscription.unsubscribe).toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith('/api/push/unsubscribe', { endpoint: 'https://push.example/xyz' })
    expect(result.current.subscribed).toBe(false)
  })
})
