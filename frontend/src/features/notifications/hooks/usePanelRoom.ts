import { useLayoutEffect, useState, type RefObject } from 'react'
import type { NotificationPlacement } from '../components/NotificationBellButton'

/** Aire entre el panel y el borde de la ventana. */
const EDGE_GAP = 12
/** Separación entre la campana y el panel cuando abre arriba (`mb-2`). */
const TOOLBAR_GAP = 8
export const PANEL_MAX_HEIGHT = 620
const DESKTOP_QUERY = '(min-width: 640px)'

/** Cuánto puede crecer el panel, según dónde quedó la campana. */
export function panelRoom(placement: NotificationPlacement, anchor: DOMRect, viewportHeight: number): number {
  const room = placement === 'header'
    ? viewportHeight - anchor.bottom - EDGE_GAP
    : placement === 'toolbar'
      ? anchor.top - TOOLBAR_GAP - EDGE_GAP
      : anchor.bottom - EDGE_GAP
  return Math.max(0, Math.min(PANEL_MAX_HEIGHT, room))
}

/**
 * Alto máximo del panel en tablet y escritorio, medido desde la campana.
 *
 * En el riel el panel se apoya en la campana y crece hacia arriba: con un
 * tope en `vh` la cuenta no incluía dónde estaba la campana, y en una
 * ventana baja el encabezado y los filtros quedaban fuera de la pantalla.
 * En el celular el panel es fijo arriba y su clase ya lo limita: null.
 */
export function usePanelRoom(
  open: boolean, placement: NotificationPlacement, anchorRef: RefObject<HTMLElement | null>,
): number | null {
  const [room, setRoom] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    function measure() {
      const anchor = anchorRef.current
      if (!anchor || !window.matchMedia(DESKTOP_QUERY).matches) {
        setRoom(null)
        return
      }
      setRoom(panelRoom(placement, anchor.getBoundingClientRect(), window.innerHeight))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, placement, anchorRef])

  return open ? room : null
}
