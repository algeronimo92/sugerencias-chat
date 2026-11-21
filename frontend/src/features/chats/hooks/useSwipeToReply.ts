import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

/** Cuánto hay que deslizar para que suelte en "responder". */
export const SWIPE_REPLY_THRESHOLD_PX = 64
/** Hasta dónde sigue al dedo; después avanza con resistencia, como WhatsApp. */
const SWIPE_MAX_PX = 80
/** Movimiento a partir del cual se decide si es un deslizamiento o un scroll.
 *  Igual que la tolerancia de la pulsación larga de la burbuja. */
const SWIPE_DECIDE_PX = 10
/** Lo horizontal tiene que ganarle claramente a lo vertical: si no, el dedo
 *  está haciendo scroll en diagonal y el hilo no debe moverse de costado. */
const SWIPE_DIRECTION_RATIO = 1.5

type Phase = 'idle' | 'deciding' | 'swiping' | 'scrolling'

/** Desplazamiento visible para un arrastre de `dx` px a la derecha. */
export function swipeOffset(dx: number): number {
  if (dx <= 0) return 0
  if (dx <= SWIPE_MAX_PX) return dx
  return Math.min(SWIPE_MAX_PX + (dx - SWIPE_MAX_PX) * 0.2, SWIPE_MAX_PX + 24)
}

/**
 * Deslizar una burbuja a la derecha para responderla, como en WhatsApp.
 *
 * Solo con el dedo o el lápiz: con mouse ya está el botón Responder del hover.
 * La burbuja y el ícono se mueven escribiendo el estilo en sus nodos y no con
 * estado de React: un hilo largo volvería a dibujar la burbuja en cada
 * movimiento del dedo.
 *
 * El contenedor que recibe los handlers necesita `touch-action: pan-y`: así el
 * navegador sigue haciendo el scroll vertical y deja lo horizontal a esto.
 */
export function useSwipeToReply({ enabled, onReply }: { enabled: boolean; onReply: () => void }) {
  const targetRef = useRef<HTMLDivElement>(null)
  const iconRef = useRef<HTMLSpanElement>(null)
  const origin = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const phase = useRef<Phase>('idle')
  const armed = useRef(false)
  // Al soltar después de deslizar el navegador dispara igual el click: sin esto
  // abriría la foto o el link que estaba bajo el dedo.
  const swallowClick = useRef(false)

  function paint(offset: number, animate: boolean) {
    const target = targetRef.current
    const icon = iconRef.current
    const transition = animate ? 'transform 180ms ease-out, opacity 180ms ease-out' : 'none'
    if (target) {
      target.style.transition = transition
      target.style.transform = offset ? `translateX(${offset}px)` : ''
    }
    if (icon) {
      const progress = Math.min(offset / SWIPE_REPLY_THRESHOLD_PX, 1)
      icon.style.transition = transition
      icon.style.opacity = String(progress)
      icon.style.transform = `translateY(-50%) scale(${0.6 + progress * 0.4})`
    }
  }

  function reset() {
    origin.current = null
    phase.current = 'idle'
    armed.current = false
    paint(0, true)
  }

  // Si la burbuja deja de aceptar respuestas a mitad del gesto (entra el modo
  // selección), vuelve a su lugar en vez de quedar corrida.
  useEffect(() => {
    if (!enabled && phase.current !== 'idle') reset()
  })

  function onPointerDown(event: PointerEvent) {
    swallowClick.current = false
    if (!enabled || event.pointerType === 'mouse' || !event.isPrimary) return
    origin.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
    phase.current = 'deciding'
  }

  function onPointerMove(event: PointerEvent) {
    const start = origin.current
    if (!start || event.pointerId !== start.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (phase.current === 'deciding') {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_DECIDE_PX) return
      if (dx > 0 && Math.abs(dx) > Math.abs(dy) * SWIPE_DIRECTION_RATIO) {
        phase.current = 'swiping'
      } else {
        phase.current = 'scrolling'
        origin.current = null
        return
      }
    }
    if (phase.current !== 'swiping') return
    const offset = swipeOffset(dx)
    const nowArmed = dx >= SWIPE_REPLY_THRESHOLD_PX
    // Un toque corto al pasar el umbral, como WhatsApp. Donde no hay
    // vibración (iPhone, escritorio) el ícono lleno alcanza para saberlo.
    if (nowArmed && !armed.current && typeof navigator !== 'undefined') navigator.vibrate?.(10)
    armed.current = nowArmed
    paint(offset, false)
  }

  function onPointerUp(event: PointerEvent) {
    const start = origin.current
    if (!start || event.pointerId !== start.pointerId) return
    const shouldReply = phase.current === 'swiping' && armed.current
    if (phase.current === 'swiping') swallowClick.current = true
    reset()
    if (shouldReply) onReply()
  }

  function onPointerCancel() {
    if (phase.current !== 'idle') reset()
  }

  function onClickCapture(event: MouseEvent) {
    if (!swallowClick.current) return
    swallowClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return {
    targetRef,
    iconRef,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
  }
}
