import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'

const LONG_PRESS_MS = 450
const LONG_PRESS_MOVE_TOLERANCE_PX = 10

/** Mantener pulsada una fila dispara `onLongPress` sin abrirla: el click que
 * el navegador emite al soltar se descarta con `consumeSuppressedClick`. */
export function useLongPress(onLongPress: () => void) {
  const longPressTimerRef = useRef<number | null>(null)
  const suppressClickTimerRef = useRef<number | null>(null)
  const longPressStartRef = useRef({ x: 0, y: 0 })
  const suppressClickRef = useRef(false)

  function cancel() {
    if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
  }

  function clearClickSuppression() {
    if (suppressClickTimerRef.current != null) window.clearTimeout(suppressClickTimerRef.current)
    suppressClickTimerRef.current = null
    suppressClickRef.current = false
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    cancel()
    longPressStartRef.current = { x: event.clientX, y: event.clientY }
    longPressTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = true
      // Algunos navegadores móviles no emiten click después del long press.
      // El seguro caduca para no tragarse el siguiente toque normal.
      suppressClickTimerRef.current = window.setTimeout(clearClickSuppression, 1_000)
      onLongPress()
      longPressTimerRef.current = null
    }, LONG_PRESS_MS)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const movedX = Math.abs(event.clientX - longPressStartRef.current.x)
    const movedY = Math.abs(event.clientY - longPressStartRef.current.y)
    if (movedX > LONG_PRESS_MOVE_TOLERANCE_PX || movedY > LONG_PRESS_MOVE_TOLERANCE_PX) cancel()
  }

  /** true si este click es el que sigue a un long press y hay que ignorarlo. */
  function consumeSuppressedClick(event: ReactMouseEvent<HTMLElement>): boolean {
    if (!suppressClickRef.current) return false
    event.preventDefault()
    clearClickSuppression()
    return true
  }

  useEffect(() => () => {
    cancel()
    clearClickSuppression()
  }, [])

  return {
    cancel,
    consumeSuppressedClick,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
    },
  }
}
