import { useState } from 'react'

/** Ids marcados en una lista paginada: marcar uno, toda la página o limpiar. */
export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  function toggle(id: string) {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Si toda la página está marcada la desmarca; si no, la marca entera. */
  function togglePage(ids: string[]) {
    setSelected(current => {
      const everyone = ids.every(id => current.has(id))
      const next = new Set(current)
      for (const id of ids) {
        if (everyone) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  return { selected, toggle, togglePage, clear: () => setSelected(new Set()) }
}
