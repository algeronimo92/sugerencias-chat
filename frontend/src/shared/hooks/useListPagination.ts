import { useState } from 'react'
import { usePageSize } from './usePageSize'

/**
 * Paginación en memoria de una lista que ya llegó completa (historial,
 * plantillas, archivos…), con las mismas filas por página que el embudo.
 *
 * `resetKey` resume los filtros de la pantalla: cuando cambia se vuelve a la
 * primera página. Sin eso, filtrar estando en la página 4 dejaba una lista
 * vacía o una página que no correspondía a nada de lo que se buscó.
 */
export function useListPagination<T>(items: readonly T[], storageKey: string, resetKey = '') {
  const [pageSize, changePageSize] = usePageSize(storageKey)
  const [state, setState] = useState({ key: resetKey, page: 0 })
  const requested = state.key === resetKey ? state.page : 0
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  // Si la lista se achica (se borró algo, llegó un refetch), la página pedida
  // puede quedar fuera: se muestra la última que existe.
  const page = Math.min(requested, pageCount - 1)
  const pageItems = items.slice(page * pageSize, (page + 1) * pageSize)

  function setPage(next: number) {
    setState({ key: resetKey, page: next })
  }

  function setPageSize(next: Parameters<typeof changePageSize>[0]) {
    changePageSize(next)
    setState({ key: resetKey, page: 0 })
  }

  return {
    page,
    pageSize,
    total,
    pageItems,
    setPage,
    setPageSize,
  }
}
