import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SWIPE_REPLY_THRESHOLD_PX, swipeOffset, useSwipeToReply } from './useSwipeToReply'

function Bubble({ enabled = true, onReply, onOpen }: { enabled?: boolean; onReply: () => void; onOpen?: () => void }) {
  const swipe = useSwipeToReply({ enabled, onReply })
  return (
    <div data-testid="row" {...swipe.handlers}>
      <span ref={swipe.iconRef} data-testid="icon" />
      <div ref={swipe.targetRef} data-testid="bubble">
        <button type="button" onClick={onOpen}>foto</button>
      </div>
    </div>
  )
}

const touch = { pointerType: 'touch', pointerId: 1, isPrimary: true }

function drag(row: HTMLElement, to: { x: number; y: number }) {
  fireEvent.pointerDown(row, { ...touch, clientX: 20, clientY: 100 })
  fireEvent.pointerMove(row, { ...touch, clientX: 20 + to.x / 2, clientY: 100 + to.y / 2 })
  fireEvent.pointerMove(row, { ...touch, clientX: 20 + to.x, clientY: 100 + to.y })
}

describe('useSwipeToReply', () => {
  it('deslizar a la derecha pasando el umbral responde y la burbuja vuelve a su lugar', () => {
    const onReply = vi.fn()
    render(<Bubble onReply={onReply} />)
    const row = screen.getByTestId('row')

    drag(row, { x: SWIPE_REPLY_THRESHOLD_PX + 10, y: 0 })
    expect(screen.getByTestId('bubble').style.transform).toBe(`translateX(${SWIPE_REPLY_THRESHOLD_PX + 10}px)`)
    expect(screen.getByTestId('icon').style.opacity).toBe('1')
    fireEvent.pointerUp(row, touch)

    expect(onReply).toHaveBeenCalledOnce()
    expect(screen.getByTestId('bubble').style.transform).toBe('')
  })

  it('soltar antes del umbral no responde', () => {
    const onReply = vi.fn()
    render(<Bubble onReply={onReply} />)
    const row = screen.getByTestId('row')

    drag(row, { x: SWIPE_REPLY_THRESHOLD_PX - 20, y: 0 })
    fireEvent.pointerUp(row, touch)

    expect(onReply).not.toHaveBeenCalled()
  })

  it('un movimiento sobre todo vertical es scroll: la burbuja no se mueve', () => {
    const onReply = vi.fn()
    render(<Bubble onReply={onReply} />)
    const row = screen.getByTestId('row')

    drag(row, { x: 90, y: 120 })
    fireEvent.pointerUp(row, touch)

    expect(screen.getByTestId('bubble').style.transform).toBe('')
    expect(onReply).not.toHaveBeenCalled()
  })

  it('con mouse no hace nada: ahí está el botón Responder', () => {
    const onReply = vi.fn()
    render(<Bubble onReply={onReply} />)
    const row = screen.getByTestId('row')

    fireEvent.pointerDown(row, { pointerType: 'mouse', pointerId: 1, isPrimary: true, clientX: 20, clientY: 100 })
    fireEvent.pointerMove(row, { pointerType: 'mouse', pointerId: 1, isPrimary: true, clientX: 120, clientY: 100 })
    fireEvent.pointerUp(row, { pointerType: 'mouse', pointerId: 1, isPrimary: true })

    expect(onReply).not.toHaveBeenCalled()
  })

  it('sin poder responder (envío en curso, modo selección) no se mueve', () => {
    const onReply = vi.fn()
    render(<Bubble enabled={false} onReply={onReply} />)
    const row = screen.getByTestId('row')

    drag(row, { x: 100, y: 0 })
    fireEvent.pointerUp(row, touch)

    expect(onReply).not.toHaveBeenCalled()
  })

  it('el click que sigue al deslizar no abre la foto que estaba debajo', () => {
    const onOpen = vi.fn()
    render(<Bubble onReply={vi.fn()} onOpen={onOpen} />)
    const row = screen.getByTestId('row')

    drag(row, { x: 100, y: 0 })
    fireEvent.pointerUp(row, touch)
    fireEvent.click(screen.getByRole('button', { name: 'foto' }))
    expect(onOpen).not.toHaveBeenCalled()

    // Un toque normal después sí la abre.
    fireEvent.pointerDown(row, { ...touch, clientX: 20, clientY: 100 })
    fireEvent.pointerUp(row, touch)
    fireEvent.click(screen.getByRole('button', { name: 'foto' }))
    expect(onOpen).toHaveBeenCalledOnce()
  })
})

describe('swipeOffset', () => {
  it('sigue al dedo y después frena', () => {
    expect(swipeOffset(-30)).toBe(0)
    expect(swipeOffset(50)).toBe(50)
    expect(swipeOffset(80)).toBe(80)
    expect(swipeOffset(130)).toBe(90)
    expect(swipeOffset(1000)).toBe(104)
  })
})
