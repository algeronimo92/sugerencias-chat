import { act, render, screen } from '@testing-library/react'
import { useState, useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hold, LEASE_FRESH_MS, resetActivity } from '../shared/activity'
import { resetPwaUpdateStore, setPwaCurrentChatId, usePwaUpdatePending } from '../shared/pwaUpdate'
import { APPLY_TIMEOUT_MS, MIN_UPDATE_CHECK_GAP_MS, PwaUpdatePrompt, UPDATE_CHECK_INTERVAL_MS } from './PwaUpdatePrompt'

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

// Envíos en vuelo: el test los fija sin levantar React Query.
const sends = vi.hoisted(() => ({ pending: 0 }))
vi.mock('../features/chats/public/usePendingSends', () => ({
  usePendingSends: () => sends.pending,
}))

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMock }))

const reload = vi.hoisted(() => ({ page: vi.fn() }))
vi.mock('./pwaReload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pwaReload')>()
  return { ...actual, reloadWhenActivated: (registration: ServiceWorkerRegistration | null) => actual.reloadWhenActivated(registration, reload.page) }
})

/** Worker en `waiting` que el test puede pasar a otro estado. */
function makeWorker() {
  const worker = new EventTarget() as EventTarget & { state: ServiceWorkerState; activate: () => void }
  worker.state = 'installed'
  worker.activate = () => {
    worker.state = 'activated'
    worker.dispatchEvent(new Event('statechange'))
  }
  return worker
}

function makeRegistration(waiting: ReturnType<typeof makeWorker> | null = makeWorker()) {
  return { update: vi.fn(() => Promise.resolve()), waiting } as unknown as ServiceWorkerRegistration & {
    update: ReturnType<typeof vi.fn>
    waiting: ReturnType<typeof makeWorker> | null
  }
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

function mount(registration = makeRegistration()) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-09T10:00:00Z'))
  const view = render(
    <>
      <PwaUpdatePrompt />
      <PendingProbe />
    </>,
  )
  act(() => sw.register('/sw.js', registration))
  return { registration, view }
}

/** Versión nueva detectada mientras la persona está en `chatId`. */
function newBuildWhileIn(chatId: string) {
  act(() => setPwaCurrentChatId(chatId))
  act(() => sw.setNeedRefresh(true))
}

describe('PwaUpdatePrompt', () => {
  beforeEach(() => {
    resetPwaUpdateStore()
    resetActivity()
    localStorage.clear()
    sessionStorage.clear()
    document.body.innerHTML = ''
    socket.set(false)
    sends.pending = 0
    toastMock.mockClear()
    toastMock.dismiss.mockClear()
    toastMock.info.mockClear()
    toastMock.error.mockClear()
    sw.updateServiceWorker.mockClear()
    reload.page.mockClear()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    setVisibility('visible')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('sondeo', () => {
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
  })

  describe('aviso que no se pierde', () => {
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

    it('vuelve a ofrecer la versión nueva al cambiar de chat cuando no se puede aplicar', () => {
      mount()
      const release = hold('recording')
      newBuildWhileIn('chat-1')
      expect(offers()).toBe(1)

      act(() => setPwaCurrentChatId('chat-2'))
      expect(offers()).toBe(2)
      expect(sw.updateServiceWorker).not.toHaveBeenCalled()
      release()
    })

    it('no ofrece nada mientras no haya versión nueva, aunque se navegue', () => {
      mount()
      act(() => setPwaCurrentChatId('chat-1'))
      act(() => setPwaCurrentChatId('chat-2'))
      setVisibility('hidden')
      setVisibility('visible')
      expect(offers()).toBe(0)
      expect(sw.updateServiceWorker).not.toHaveBeenCalled()
    })
  })

  describe('recarga automática segura', () => {
    it('aplica la versión nueva al cambiar de chat si no hay nada a medias, con texto visible', () => {
      mount()
      newBuildWhileIn('chat-1')
      expect(sw.updateServiceWorker).not.toHaveBeenCalled()

      act(() => setPwaCurrentChatId('chat-2'))
      expect(sw.updateServiceWorker).toHaveBeenCalledWith(true)
      expect(screen.getByRole('status')).toHaveTextContent(/Actualizando/)
      expect(sessionStorage.getItem('pwa-update-applied')).toBe('1')
      expect(toastMock.dismiss).toHaveBeenCalledWith('pwa-update')
    })

    it('no aplica en el mismo momento en que aparece la versión nueva', () => {
      mount()
      act(() => setPwaCurrentChatId('chat-1'))
      act(() => sw.setNeedRefresh(true))
      expect(sw.updateServiceWorker).not.toHaveBeenCalled()
      expect(offers()).toBe(1)
    })

    it.each([
      ['una grabación en curso', () => hold('recording'), /grabación/],
      ['adjuntos sin enviar', () => hold('pending-media'), /adjuntos/],
      ['una respuesta a medias', () => hold('reply'), /respuesta/],
      ['mensajes seleccionados', () => hold('selection'), /seleccionados/],
      ['cambios sin guardar en el editor de flujos', () => hold('flow-editor'), /editor de flujos/],
    ])('no recarga con %s y lo deja escrito en consola', (_name, block, reason) => {
      mount()
      const release = block()
      newBuildWhileIn('chat-1')
      act(() => setPwaCurrentChatId('chat-2'))
      expect(sw.updateServiceWorker).not.toHaveBeenCalled()
      expect(console.info).toHaveBeenCalledWith(expect.stringMatching(reason))
      release()
    })

    it('no recarga mientras haya un envío en vuelo, y sí cuando termina y se vuelve a navegar', () => {
      mount()
      sends.pending = 1
      newBuildWhileIn('chat-1')
      act(() => setPwaCurrentChatId('chat-2'))
      expect(sw.updateServiceWorker).not.toHaveBeenCalled()

      sends.pending = 0
      act(() => setPwaCurrentChatId('chat-3'))
      expect(sw.updateServiceWorker).toHaveBeenCalledWith(true)
    })

    it('no recarga mientras otra pestaña del CRM tenga algo a medias', () => {
      mount()
      localStorage.setItem('pwa-activity:otra-pestana', String(Date.now() - LEASE_FRESH_MS / 2))
      newBuildWhileIn('chat-1')
      act(() => setPwaCurrentChatId('chat-2'))
      expect(sw.updateServiceWorker).not.toHaveBeenCalled()
      expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/otra pestaña/))
    })

    it('no recarga con un diálogo abierto', () => {
      mount()
      document.body.insertAdjacentHTML('beforeend', '<div role="dialog"></div>')
      newBuildWhileIn('chat-1')
      act(() => setPwaCurrentChatId('chat-2'))
      expect(sw.updateServiceWorker).not.toHaveBeenCalled()
    })

    it('si el worker nuevo no toma el control, quita el velo y pide recargar a mano', () => {
      mount()
      newBuildWhileIn('chat-1')
      act(() => setPwaCurrentChatId('chat-2'))
      expect(screen.getByRole('status')).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(APPLY_TIMEOUT_MS))
      expect(screen.queryByRole('status')).toBeNull()
      expect(toastMock.error).toHaveBeenCalled()
    })
  })

  describe('botón manual', () => {
    it('"Actualizar" aplica el worker nuevo y deja constancia para el log del build', () => {
      mount()
      act(() => sw.setNeedRefresh(true))
      act(() => lastOfferOptions().action.onClick())
      expect(sw.updateServiceWorker).toHaveBeenCalledWith(true)
      expect(sessionStorage.getItem('pwa-update-applied')).toBe('1')
    })

    it('recarga cuando el worker nuevo queda activo, aunque la página no estuviera controlada al cargar', () => {
      const registration = mount().registration
      act(() => sw.setNeedRefresh(true))
      act(() => lastOfferOptions().action.onClick())
      expect(reload.page).not.toHaveBeenCalled()
      act(() => registration.waiting!.activate())
      expect(reload.page).toHaveBeenCalledTimes(1)
    })

    it('recarga ya mismo si otra pestaña ya activó la versión nueva', () => {
      mount(makeRegistration(null))
      act(() => sw.setNeedRefresh(true))
      act(() => lastOfferOptions().action.onClick())
      expect(reload.page).toHaveBeenCalledTimes(1)
    })

    it('"Actualizar" pasa por el mismo filtro y explica qué lo frena', () => {
      mount()
      const release = hold('reply')
      act(() => sw.setNeedRefresh(true))
      act(() => lastOfferOptions().action.onClick())
      expect(sw.updateServiceWorker).not.toHaveBeenCalled()
      expect(toastMock.info).toHaveBeenCalledWith(
        expect.stringMatching(/Todavía no/),
        expect.objectContaining({ description: expect.stringMatching(/respuesta a medias/) }),
      )
      release()
    })
  })

  it('escribe en consola el build aplicado tras actualizar', () => {
    sessionStorage.setItem('pwa-update-applied', '1')
    mount()
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('versión nueva aplicada'))
    expect(sessionStorage.getItem('pwa-update-applied')).toBeNull()
  })
})
