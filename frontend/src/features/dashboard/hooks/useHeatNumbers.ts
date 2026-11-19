import { useCallback, useSyncExternalStore } from 'react'
import { useIsMobile } from '../../../shared/hooks/useBreakpoint'

const STORAGE_KEY = 'dashboard-mapa-numeros'
const listeners = new Set<() => void>()

// La elección es de quien mira y vale para todos los mapas del panel: se
// guarda en este navegador. Si el almacenamiento falla (ventana privada), el
// interruptor sigue funcionando mientras dure la página.
let memory: string | null = null

function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return memory
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}

/**
 * Si los mapas de calor escriben el número dentro de cada celda.
 *
 * Sin elección previa, sí en pantallas anchas y no en el celular: ahí las
 * celdas miden unos 26 px y ochenta números juntos tapan el patrón, que es lo
 * primero que el mapa tiene que dejar ver. Es un almacén compartido y no un
 * estado por mapa: al cambiarlo en uno, cambian todos los que están a la vista.
 */
export function useHeatNumbers(): [boolean, (show: boolean) => void] {
  const isMobile = useIsMobile()
  const stored = useSyncExternalStore(subscribe, read, () => null)
  const setShow = useCallback((show: boolean) => {
    memory = show ? 'si' : 'no'
    try {
      localStorage.setItem(STORAGE_KEY, memory)
    } catch {
      // Se queda con lo que hay en memoria.
    }
    listeners.forEach(listener => listener())
  }, [])
  return [stored === null ? !isMobile : stored === 'si', setShow]
}
