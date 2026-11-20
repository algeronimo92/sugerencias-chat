import type { ChatFilters } from '../../../leads/types'

/** Cuántos filtros avanzados están puestos: el número del botón de filtros
 * y lo que habilita guardar la vista. */
export function activeFilterCount(filters: ChatFilters): number {
  return (
    filters.stages.length +
    filters.tagIds.length +
    Number(!!filters.service) +
    Number(!!filters.sellerId) +
    Number(!!filters.origin) +
    Number(!!filters.lastSender) +
    Number(!!filters.inactiveDays) +
    Number(!!filters.waitingTime) +
    Number(filters.automationPaused)
  )
}
