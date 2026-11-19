import { useState } from 'react'

/** Un sí/no que se recuerda en este equipo (paneles plegados). Es comodidad:
 *  sin almacenamiento vale para la sesión. */
export function useStoredToggle(storageKey: string, initial = false): [boolean, () => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      return stored === null ? initial : stored === 'true'
    } catch {
      return initial
    }
  })

  // Guardar fuera del updater: React puede llamarlo dos veces y debe ser puro.
  function toggle() {
    const next = !value
    setValue(next)
    try {
      localStorage.setItem(storageKey, String(next))
    } catch {
      // Sin almacenamiento el cambio vale para esta sesión.
    }
  }

  return [value, toggle]
}
