import { EMPTY_CHAT_FILTERS, type ChatFilters } from '../../leads/types'

/**
 * Filtros con los que se piden los números de las bandejas: solo los que no
 * son bandejas (etiquetas, servicio, origen). Así "Mías 12" dice cuántos
 * habría al tocarla, sin que la bandeja elegida deje en cero a las demás.
 */
export function inboxCountFilters(advanced: ChatFilters): ChatFilters {
  return {
    ...EMPTY_CHAT_FILTERS,
    tagIds: advanced.tagIds,
    tagMode: advanced.tagMode,
    service: advanced.service,
    origin: advanced.origin,
  }
}
