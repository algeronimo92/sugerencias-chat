/**
 * El scroll del hilo es la parte del chat que más fácil se rompe sin que se
 * note: nada tira error, simplemente la vista salta sola mientras alguien lee.
 *
 * Estos tests fijan los cuatro comportamientos que los usuarios sí notan:
 * abrir un chat en el último mensaje, quedarse quieto al cargar mensajes
 * viejos, saltar a un mensaje citado, y avisar sin moverse cuando llega algo
 * nuevo mientras se lee historial.
 */

import { render, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useThreadScroll } from './useThreadScroll'

const CHAT_ID = '7b08f4d9-855f-4718-b95f-9c021da52f77'
const OTHER_CHAT_ID = 'cd6d8427-852b-432f-a066-9a6471a7acc0'

type Params = Parameters<typeof useThreadScroll>[0]

const BASE_PARAMS: Params = {
  chatId: CHAT_ID,
  highlightMessageId: null,
  isLoading: false,
  lastTimelineKey: 'message-3',
  timelineLength: 3,
  pageCount: 1,
  historyPageCount: 0,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: async () => ({ isError: false }),
  historyError: null,
}

/** jsdom no hace layout: scrollHeight y clientHeight son siempre 0. Se
 *  sobrescriben para poder simular un hilo con contenido y una ventana. */
function fakeGeometry(el: HTMLElement, { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

let latest: ReturnType<typeof useThreadScroll>

function Harness({ params, messageIds = [] }: { params: Params; messageIds?: number[] }) {
  const scroll = useThreadScroll(params)
  latest = scroll
  return (
    <div
      data-testid="thread"
      ref={scroll.threadRef}
      onScroll={scroll.handleThreadScroll}
    >
      <div ref={scroll.contentRef}>
        {messageIds.map((id) => (
          <div key={id} data-message-id={id}>
            mensaje {id}
          </div>
        ))}
      </div>
      <div data-testid="bottom" ref={scroll.bottomRef} />
    </div>
  )
}

/** Deja correr el requestAnimationFrame que usa el hook para scrollear. */
async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  })
}

function renderThread(overrides: Partial<Params> = {}, messageIds: number[] = []) {
  const params = { ...BASE_PARAMS, ...overrides }
  const view = render(<Harness params={params} messageIds={messageIds} />)
  const thread = view.getByTestId('thread')
  fakeGeometry(thread, { scrollHeight: 2000, clientHeight: 500 })
  return { ...view, thread, params }
}

describe('useThreadScroll', () => {
  beforeEach(() => {
    latest = undefined as unknown as ReturnType<typeof useThreadScroll>
  })

  it('abre el chat en el último mensaje', async () => {
    const { thread } = renderThread()
    // El efecto de apertura ya corrió con scrollHeight 0; se vuelve a montar
    // con la geometría puesta para observar el resultado del rAF.
    thread.scrollTop = 0
    await flushFrame()

    // Al abrir, la vista queda pegada al fondo del hilo.
    expect(thread.scrollTop).toBe(thread.scrollHeight)
  })

  it('mantiene la vista al cargar mensajes viejos, compensando lo que se agregó arriba', async () => {
    const { thread, rerender, params } = renderThread({ hasNextPage: true })
    await flushFrame()

    // El usuario está leyendo por la mitad del historial.
    thread.scrollTop = 400

    let resolveRequest: (result: { isError: boolean }) => void = () => {}
    const request = () => new Promise<{ isError: boolean }>((resolve) => { resolveRequest = resolve })

    act(() => { latest.loadOlder(request) })

    // Llega la página: el contenido crece 1000px hacia arriba.
    fakeGeometry(thread, { scrollHeight: 3000, clientHeight: 500 })
    await act(async () => {
      resolveRequest({ isError: false })
    })
    rerender(<Harness params={{ ...params, hasNextPage: true, pageCount: 2, timelineLength: 6 }} />)
    await flushFrame()

    // 400 + (3000 - 2000): el mensaje que estaba leyendo queda en el mismo
    // lugar de la pantalla, no salta.
    expect(thread.scrollTop).toBe(1400)
  })

  it('no mueve la vista si el pedido de mensajes viejos falla', async () => {
    const { thread, rerender, params } = renderThread({ hasNextPage: true })
    await flushFrame()
    thread.scrollTop = 400

    await act(async () => {
      latest.loadOlder(async () => ({ isError: true }))
    })

    // Aunque el alto cambie por cualquier otro motivo, el snapshot descartado
    // no debe aplicarse.
    fakeGeometry(thread, { scrollHeight: 3000, clientHeight: 500 })
    rerender(<Harness params={{ ...params, hasNextPage: true, pageCount: 2 }} />)
    await flushFrame()

    expect(thread.scrollTop).toBe(400)
  })

  it('pide la página siguiente al llegar arriba de todo, y solo una vez', async () => {
    const fetchNextPage = vi.fn(async () => ({ isError: false }))
    const { thread } = renderThread({ hasNextPage: true, fetchNextPage })
    await flushFrame()

    thread.scrollTop = 10
    act(() => { latest.handleThreadScroll() })
    act(() => { latest.handleThreadScroll() })

    // El segundo scroll cae mientras el primero sigue en vuelo: no duplica.
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('ignora un segundo pedido de mensajes viejos mientras el primero sigue en vuelo', async () => {
    renderThread({ hasNextPage: true })
    await flushFrame()

    // loadOlder no se llama solo desde el scroll: también lo usan el botón
    // "Cargar mensajes anteriores" y el CTA de historial de WhatsApp, que no
    // tienen la guarda que sí tiene handleThreadScroll. Sin la guarda propia,
    // dos toques seguidos toman dos snapshots y el segundo pisa al primero,
    // que es exactamente lo que hace saltar la vista.
    const request = vi.fn(() => new Promise<{ isError: boolean }>(() => {}))

    act(() => { latest.loadOlder(request) })
    act(() => { latest.loadOlder(request) })

    expect(request).toHaveBeenCalledTimes(1)
  })

  it('no pagina si el usuario todavía no llegó arriba', async () => {
    const fetchNextPage = vi.fn(async () => ({ isError: false }))
    const { thread } = renderThread({ hasNextPage: true, fetchNextPage })
    await flushFrame()

    thread.scrollTop = 900
    act(() => { latest.handleThreadScroll() })

    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it('ofrece el botón de bajar solo cuando la vista está lejos del final', async () => {
    const { thread } = renderThread()
    await flushFrame()

    // A 100px del fondo (2000 - 1400 - 500): cerca, no hace falta el botón.
    thread.scrollTop = 1400
    act(() => { latest.handleThreadScroll() })
    expect(latest.showScrollToBottom).toBe(false)

    // A 1500px del fondo: ya se perdió de vista el final.
    thread.scrollTop = 0
    act(() => { latest.handleThreadScroll() })
    expect(latest.showScrollToBottom).toBe(true)
  })

  it('avisa de mensajes nuevos sin mover al usuario que está leyendo historial', async () => {
    const { thread, rerender, params } = renderThread()
    await flushFrame()

    // El usuario sube a leer historial.
    thread.scrollTop = 0
    act(() => { latest.handleThreadScroll() })
    expect(latest.hasNewWhileAway).toBe(false)

    // Llega un mensaje nuevo al final del hilo.
    rerender(<Harness params={{ ...params, lastTimelineKey: 'message-4', timelineLength: 4 }} />)
    await flushFrame()

    expect(latest.hasNewWhileAway).toBe(true)
    // Y sobre todo: no lo arrastró al fondo.
    expect(thread.scrollTop).toBe(0)
  })

  it('salta a un mensaje citado y lo resalta', async () => {
    renderThread({}, [1, 2, 3])
    await flushFrame()

    const scrollIntoView = vi.fn()
    const target = document.querySelector('[data-message-id="2"]') as HTMLElement
    target.scrollIntoView = scrollIntoView

    act(() => { latest.goToQuotedMessage(2) })
    await flushFrame()

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(latest.flashMessageId).toBe(2)
  })

  it('pagina hacia atrás buscando un mensaje citado que todavía no está cargado', async () => {
    const fetchNextPage = vi.fn(async () => ({ isError: false }))
    const { rerender, params } = renderThread({ hasNextPage: true, fetchNextPage }, [1, 2, 3])
    await flushFrame()

    // El 99 no está en el DOM: no se puede saltar todavía.
    act(() => { latest.goToQuotedMessage(99) })
    await flushFrame()

    rerender(<Harness params={{ ...params, hasNextPage: true, fetchNextPage }} messageIds={[1, 2, 3]} />)

    expect(fetchNextPage).toHaveBeenCalled()
  })

  it('vuelve al estado inicial al cambiar de chat', async () => {
    const { thread, rerender, params } = renderThread()
    await flushFrame()

    thread.scrollTop = 0
    act(() => { latest.handleThreadScroll() })
    expect(latest.showScrollToBottom).toBe(true)

    rerender(<Harness params={{ ...params, chatId: OTHER_CHAT_ID }} />)

    expect(latest.showScrollToBottom).toBe(false)
    expect(latest.hasNewWhileAway).toBe(false)
  })
})
