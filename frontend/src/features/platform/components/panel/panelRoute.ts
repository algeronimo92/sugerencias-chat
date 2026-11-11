import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'

/** Secciones de primer nivel del panel. */
export const SECCIONES_PANEL = ['negocios', 'integraciones', 'plantillas'] as const
export type SeccionPanel = (typeof SECCIONES_PANEL)[number]

/**
 * Dónde está parado el operador. Vive en el hash del enlace
 * (`#negocios/<id>/<apartado>`) y no en la ruta: el panel se sirve entero bajo
 * `/platform` y así un enlace a un negocio concreto se puede compartir, abrir
 * en otra pestaña y recorrer con atrás/adelante sin tocar el enrutador del CRM.
 */
export interface RutaPanel {
  seccion: SeccionPanel
  /** Solo en `negocios`: el negocio abierto. `null` es el directorio. */
  negocioId: string | null
  /** Apartado del negocio abierto. Lo valida quien lo pinta (businessSections). */
  apartado: string | null
}

export const RUTA_NEGOCIOS: RutaPanel = { seccion: 'negocios', negocioId: null, apartado: null }

export function rutaSeccion(seccion: SeccionPanel): RutaPanel {
  return { seccion, negocioId: null, apartado: null }
}

export function rutaNegocio(negocioId: string, apartado: string | null = null): RutaPanel {
  return { seccion: 'negocios', negocioId, apartado }
}

export function leerRuta(hash: string): RutaPanel {
  const [seccion, negocioId, apartado] = hash.replace(/^#/, '').split('/')
  const conocida = SECCIONES_PANEL.find((id) => id === seccion)
  if (!conocida) return RUTA_NEGOCIOS
  if (conocida !== 'negocios' || !negocioId) return rutaSeccion(conocida)
  return rutaNegocio(negocioId, apartado || null)
}

export function hashDeRuta(ruta: RutaPanel): string {
  if (ruta.seccion !== 'negocios' || !ruta.negocioId) return `#${ruta.seccion}`
  return ruta.apartado ? `#negocios/${ruta.negocioId}/${ruta.apartado}` : `#negocios/${ruta.negocioId}`
}

interface NavegacionPanel {
  ruta: RutaPanel
  irA: (destino: RutaPanel) => void
}

export const PanelNavContext = createContext<NavegacionPanel | null>(null)

export function usePanelNav(): NavegacionPanel {
  const navegacion = useContext(PanelNavContext)
  if (!navegacion) throw new Error('usePanelNav se usa dentro del panel de plataforma')
  return navegacion
}

function suscribirAlHash(avisar: () => void) {
  window.addEventListener('popstate', avisar)
  window.addEventListener('hashchange', avisar)
  return () => {
    window.removeEventListener('popstate', avisar)
    window.removeEventListener('hashchange', avisar)
  }
}

function leerHash(): string {
  return window.location.hash
}

function irA(destino: RutaPanel) {
  const hash = hashDeRuta(destino)
  if (hash === window.location.hash) return
  // pushState y no replaceState: entrar a un negocio y volver al directorio
  // con "atrás" es el recorrido natural de una vista maestro-detalle.
  window.history.pushState(null, '', hash)
  // pushState no avisa a nadie: sin este evento el panel no se enteraría.
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** La ruta del panel, leída del hash: el enlace es la única fuente de verdad,
 *  así que atrás/adelante y un enlace pegado a mano se ven igual que un clic. */
export function usePanelRoute(): NavegacionPanel {
  const hash = useSyncExternalStore(suscribirAlHash, leerHash)
  return useMemo(() => ({ ruta: leerRuta(hash), irA }), [hash])
}
