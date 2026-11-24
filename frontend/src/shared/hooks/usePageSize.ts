import { useState } from 'react'

export const PAGE_SIZES = [10, 20, 50] as const
export type PageSize = (typeof PAGE_SIZES)[number]

function readPageSize(storageKey: string): PageSize {
  try {
    const stored = Number(localStorage.getItem(storageKey))
    return PAGE_SIZES.find((size) => size === stored) ?? 10
  } catch {
    return 10
  }
}

/** Filas por página de una lista paginada, recordadas en el navegador con
 *  una clave por pantalla (embudos y tareas no comparten la elección). */
export function usePageSize(storageKey: string) {
  const [size, setSize] = useState<PageSize>(() => readPageSize(storageKey))
  function changeSize(next: PageSize) {
    setSize(next)
    try {
      localStorage.setItem(storageKey, String(next))
    } catch {
      // Sin almacenamiento la elección dura lo que la pestaña.
    }
  }
  return [size, changeSize] as const
}
