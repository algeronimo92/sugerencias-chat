import { useEffect, type RefObject } from 'react'

/** La franja que activa el desplazamiento es una parte del contenedor (con
 *  mínimo y máximo): con 72 px fijos había que atinar a un punto exacto. */
const EDGE_RATIO = 0.2
const MIN_EDGE = 56
const MAX_EDGE = 140
/** Velocidad (px por cuadro): crece al acercarse al borde y es máxima en él o
 *  más allá. */
const MIN_SPEED = 4
const MAX_SPEED = 22

function speedFor(depth: number, edge: number) {
  return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.min(1, depth / edge)
}

/**
 * Desplaza `ref` mientras se arrastra un lead con el puntero cerca de uno de
 * sus bordes, en el eje indicado.
 *
 * Al pasar el embudo a lista paginada y tablero con selector, el
 * desplazamiento que hacía el navegador solo al arrastrar dejó de ser
 * fiable: en la lista no bajaba y en el tablero avanzaba un poco y se
 * trababa. No se depende más de eso: mientras dure el arrastre se lee la
 * posición del puntero en cada `dragover` y un bucle de animación desplaza el
 * contenedor, también con el puntero quieto en el borde.
 */
export function useDragAutoScroll(ref: RefObject<HTMLElement | null>, axis: 'x' | 'y', active: boolean) {
  useEffect(() => {
    if (!active) return
    let pointer: { x: number; y: number } | null = null
    let frame = 0

    function onDragOver(event: DragEvent) {
      pointer = { x: event.clientX, y: event.clientY }
    }

    // Por si el arrastre termina sin que el lead avise (p. ej. se soltó fuera
    // de la ventana): sin puntero, el bucle deja de desplazar.
    function onDragFinish() {
      pointer = null
    }

    function step() {
      const element = ref.current
      if (element && pointer) {
        const rect = element.getBoundingClientRect()
        // Solo si el puntero está a la altura (o el ancho) del contenedor: si
        // no, arrastrar sobre otra parte de la pantalla lo movería sin querer.
        const across = axis === 'x' ? pointer.y >= rect.top && pointer.y <= rect.bottom : pointer.x >= rect.left && pointer.x <= rect.right
        if (across) {
          const position = axis === 'x' ? pointer.x : pointer.y
          const start = axis === 'x' ? rect.left : rect.top
          const end = axis === 'x' ? rect.right : rect.bottom
          const edge = Math.min(MAX_EDGE, Math.max(MIN_EDGE, (end - start) * EDGE_RATIO))
          // Sin límite por fuera: con el puntero sobre la cabecera sigue
          // subiendo y sobre la paginación o la barra de abajo sigue bajando.
          let delta = 0
          if (position < start + edge) delta = -speedFor(start + edge - position, edge)
          else if (position > end - edge) delta = speedFor(position - (end - edge), edge)
          if (delta !== 0) {
            if (axis === 'x') element.scrollLeft += delta
            else element.scrollTop += delta
          }
        }
      }
      frame = requestAnimationFrame(step)
    }

    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('drop', onDragFinish, true)
    document.addEventListener('dragend', onDragFinish, true)
    frame = requestAnimationFrame(step)
    return () => {
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('drop', onDragFinish, true)
      document.removeEventListener('dragend', onDragFinish, true)
      cancelAnimationFrame(frame)
    }
  }, [ref, axis, active])
}
