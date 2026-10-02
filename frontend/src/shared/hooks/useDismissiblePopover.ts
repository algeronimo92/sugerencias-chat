import { useEffect, useRef, type RefObject } from 'react'

/**
 * Cierra un popover al pulsar fuera de él o presionar Escape. El listener usa
 * pointerdown en captura para funcionar igual con mouse, touch y stylus, y
 * para cerrar el menú anterior antes de que el click abra uno nuevo.
 *
 * `additionalRef` permite considerar como parte del mismo componente un
 * panel renderizado en portal (por ejemplo, las reacciones de un mensaje).
 */
export function useDismissiblePopover<T extends HTMLElement>(
  open: boolean,
  onDismiss: () => void,
  additionalRef?: RefObject<HTMLElement | null>,
) {
  const containerRef = useRef<T>(null)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (containerRef.current?.contains(target) || additionalRef?.current?.contains(target)) return
      dismissRef.current()
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') dismissRef.current()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [additionalRef, open])

  return containerRef
}

