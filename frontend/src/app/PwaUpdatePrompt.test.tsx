import { act, render } from '@testing-library/react'
import { useState, useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetPwaUpdateStore, setPwaCurrentChatId, usePwaUpdatePending } from '../shared/pwaUpdate'
import { MIN_UPDATE_CHECK_GAP_MS, PwaUpdatePrompt, UPDATE_CHECK_INTERVAL_MS } from './PwaUpdatePrompt'

// Doble de `useRegisterSW`: el test decide cuándo "aparece" un worker nuevo
// (setNeedRefresh) y entrega el registro para que el prompt pueda sondear.
const sw = vi.hoisted(() => ({
  setNeedRefresh: (_value: boolean) => {},
  register: (_url: string, registration: ServiceWorkerRegistration) => {
    void registration
  },
  updateServiceWorker: vi.fn(),
}))

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: { onRegisteredSW?: (url: string, registration?: ServiceWorkerRegistration) => void }) => {
    const [needRefresh, setNeedRefresh] = useState(false)
    sw.setNeedRefresh = setNeedRefresh
    sw.register = (url, registration) => options.onRegisteredSW?.(url, registration)
    return {
      needRefresh: [needRefresh, setNeedRefresh],
      offlineReady: [false, () => {}],
      updateServiceWorker: sw.updateServiceWorker,
    }
  },
}))

// Store mínimo del socket, con la misma forma que el real.
const socket = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  let connected = false
  return {
    set(value: boolean) {
      connected = value
      listeners.forEach(listener => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get: () => connected,
  }
})

vi.mock('../realtime/useRealtime', () => ({
  useChatSocketConnected: () => useSyncExternalStore(socket.subscribe, socket.get, () => false),
}))

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMock }))

function makeRegistration() {
  return { update: vi.fn(() => Promise.resolve()) } as unknown as ServiceWorkerRegistration & { update: ReturnType<typeof vi.fn> }
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

function offers() {
  return toastMock.mock.calls.filter(([message]) => String(message).includes('versión nueva')).length
}

function lastOfferOptions() {
  const call = toastMock.mock.calls.at(-1)
  return call?.[1] as { action: { onClick: () => void }; cancel: { label: string; onClick: () => void }; onDismiss?: () => void }
}

/** Lee el estado compartido con la cabecera tal como lo haría el chip. */
function PendingProbe() {
  const pending = usePwaUpdatePending()
  return <span data-testid="pending">{pending ? 'pendiente' : 'al día'}</span>
}

function mount() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-09T10:00:00Z'))
  const registration = makeRegistration()
  const view = render(
    <>
      <PwaUpdatePrompt />
      <PendingProbe />
    </>,
  )
  act(() => sw.register('/sw.js', registration))
  return { registration, view }
}

describe('PwaUpdatePrompt', () => {
  beforeEach(() => {
    resetPwaUpdateStore()
    socket.set(false)
    toastMock.mockClear()
    toastMock.dismiss.mockClear()
    sw.updateServiceWorker.mockClear()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    setVisibility('visible')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('busca una versión nueva al volver a primer plano, pero no más de una vez cada 5 minutos', () => {
    const { registration } = mount()
    // Registrar ya comprobó: el primer evento inmediato no repite el pedido.
    setVisibility('hidden')
    setVisibility('visible')
    expect(registration.update).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(MIN_UPDATE_CHECK_GAP_MS))
    setVisibility('hidden')
    setVisibility('visible')
    expect(registration.update).toHaveBeenCalledTimes(1)

    // Ráfaga: ventana al frente, socket que reconecta, otra vez al frente.
    setVisibility('hidden')
    setVisibility('visible')
    act(() => socket.set(true))
    act(() => socket.set(false))
    act(() => socket.set(true))
    expect(registration.update).toHaveBeenCalledTimes(1)

    act(() => vi.advanceTimersByTime(MIN_UPDATE_CHECK_GAP_MS))
    act(() => socket.set(false))
    act(() => socket.set(true))
    expect(registration.update).toHaveBeenCalledTimes(2)
  })

  it('busca una versión nueva cuando el socket pasa de desconectado a conectado, no mientras sigue conectado', () => {
    const { registration } = mount()
    act(() => vi.advanceTimersByTime(MIN_UPDATE_CHECK_GAP_MS))
    act(() => socket.set(true))
    expect(registration.update).toHaveBeenCalledTimes(1)

    act(() => vi.advanceTimersByTime(MIN_UPDATE_CHECK_GAP_MS))
    act(() => socket.set(true))
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('mantiene el sondeo horario', () => {
    const { registration } = mount()
    act(() => vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS))
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('descartar el aviso no apaga la versión pendiente y la cabecera la sigue mostrando', () => {
    const { view } = mount()
    act(() => sw.setNeedRefresh(true))
    expect(offers()).toBe(1)
    expect(view.getByTestId('pending')).toHaveTextContent('pendiente')

    act(() => {
      lastOfferOptions().cancel.onClick()
      lastOfferOptions().onDismiss?.()
    })
    expect(view.getByTestId('pending')).toHaveTextContent('pendiente')
    expect(sw.updateServiceWorker).not.toHaveBeenCalled()
  })

  it('vuelve a ofrecer la versión nueva al volver a primer plano', () => {
    mount()
    act(() => sw.setNeedRefresh(true))
    expect(offers()).toBe(1)

    setVisibility('hidden')
    expect(offers()).toBe(1)
    setVisibility('visible')
    expect(offers()).toBe(2)
  })

  it('vuelve a ofrecer la versión nueva al cambiar de chat', () => {
    mount()
    act(() => setPwaCurrentChatId('chat-1'))
    act(() => sw.setNeedRefresh(true))
    expect(offers()).toBe(1)

    act(() => setPwaCurrentChatId('chat-2'))
    expect(offers()).toBe(2)
    // Salir del chat también cuenta como moverse por la app.
    act(() => setPwaCurrentChatId(null))
    expect(offers()).toBe(3)
  })

  it('no ofrece nada mientras no haya versión nueva, aunque se navegue', () => {
    mount()
    act(() => setPwaCurrentChatId('chat-1'))
    setVisibility('hidden')
    setVisibility('visible')
    expect(offers()).toBe(0)
  })

  it('"Actualizar" aplica el worker nuevo y deja constancia para el log del build', () => {
    mount()
    act(() => sw.setNeedRefresh(true))
    act(() => lastOfferOptions().action.onClick())
    expect(sw.updateServiceWorker).toHaveBeenCalledWith(true)
    expect(sessionStorage.getItem('pwa-update-applied')).toBe('1')
  })

  it('escribe en consola el build aplicado tras actualizar', () => {
    sessionStorage.setItem('pwa-update-applied', '1')
    mount()
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('versión nueva aplicada'))
    expect(sessionStorage.getItem('pwa-update-applied')).toBeNull()
  })
})
