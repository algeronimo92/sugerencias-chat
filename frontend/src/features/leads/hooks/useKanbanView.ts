import { useState } from 'react'
import { usePageSize } from '../../../shared/hooks/usePageSize'

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

/** Filas por página de la lista, recordadas como la vista. */
export function useKanbanPageSize() {
  return usePageSize('kanban:filas')
}
