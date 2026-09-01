import { useCallback, useSyncExternalStore } from 'react'

/**
 * Ancho al que la app cambia de forma. Coinciden con los breakpoints de
 * Tailwind para que las clases `md:` / `xl:` y este hook nunca discrepen.
 */
const MD = 768
const XL = 1280

export type Layout = 'mobile' | 'tablet' | 'desktop'

/**
 * - `mobile`  (< 768px): una vista a la vez y navegación inferior.
 * - `tablet`  (768–1279px): lista + conversación; las sugerencias van en panel.
 * - `desktop` (>= 1280px): las tres columnas clásicas.
 *
 * El corte de escritorio es 1280 y no 1024 porque las columnas laterales
 * suman ~760px fijos (barra lateral de navegación + lista de chats +
 * sugerencias): por debajo de eso la conversación queda inusable.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mediaQuery = window.matchMedia(query)
      mediaQuery.addEventListener('change', onStoreChange)
      return () => mediaQuery.removeEventListener('change', onStoreChange)
    },
    [query],
  )

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // Sin DOM (tests, prerender) se asume el layout ancho, que es el que la
    // app ya usaba antes de ser adaptativa.
    () => false,
  )
}

export function useLayout(): Layout {
  const isBelowMd = useMediaQuery(`(max-width: ${MD - 1}px)`)
  const isBelowXl = useMediaQuery(`(max-width: ${XL - 1}px)`)

  if (isBelowMd) return 'mobile'
  if (isBelowXl) return 'tablet'
  return 'desktop'
}

/** Atajo para las decisiones que solo distinguen "pantalla chica". */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MD - 1}px)`)
}
