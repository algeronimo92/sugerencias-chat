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

  function toggle() {
    setValue((current) => {
      const next = !current
      try {
        localStorage.setItem(storageKey, String(next))
      } catch {
        // Sin almacenamiento el cambio vale para esta sesión.
      }
      return next
    })
  }

  return [value, toggle]
}
