import { useState } from 'react'

export type KanbanView = 'lista' | 'tablero'

const STORAGE_KEY = 'kanban:vista'

function readView(): KanbanView {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'lista' ? 'lista' : 'tablero'
  } catch {
    return 'tablero'
  }
}

/** Cada persona elige cómo prefiere ver el embudo y se le recuerda en su
 *  navegador. Arranca en el tablero, el que el equipo ya conoce; la lista por
 *  etapas queda a un click para quien la prefiera. */
export function useKanbanView() {
  const [view, setView] = useState<KanbanView>(readView)
  function changeView(next: KanbanView) {
    setView(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Sin almacenamiento (modo privado) la elección dura lo que la pestaña.
    }
  }
  return [view, changeView] as const
}

export const PAGE_SIZES = [10, 20, 50] as const
export type PageSize = (typeof PAGE_SIZES)[number]
const PAGE_SIZE_KEY = 'kanban:filas'

function readPageSize(): PageSize {
  try {
    const stored = Number(localStorage.getItem(PAGE_SIZE_KEY))
    return PAGE_SIZES.find((size) => size === stored) ?? 10
  } catch {
    return 10
  }
}

/** Filas por página de la lista, recordadas como la vista. */
export function useKanbanPageSize() {
  const [size, setSize] = useState<PageSize>(readPageSize)
  function changeSize(next: PageSize) {
    setSize(next)
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(next))
    } catch {
      // Sin almacenamiento la elección dura lo que la pestaña.
    }
  }
  return [size, changeSize] as const
}
