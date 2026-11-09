import type { ChatFilters } from '../../leads/types'
import { EMPTY_CHAT_FILTERS } from '../../leads/types'

/**
 * Vistas de la lista de chats: combinaciones de filtros avanzados que se
 * aplican con un click. Armar "esperando respuesta hace más de 1 hora" pedía
 * abrir el panel, elegir el desplegable y cerrarlo, varias veces al día.
 */

export interface ChatView {
  id: string
  label: string
  /** Solo los campos que la vista fija; el resto queda en cero. */
  filters: Partial<ChatFilters>
  /** Las predefinidas no se pueden borrar. */
  builtIn?: boolean
}

export const BUILT_IN_VIEWS: readonly ChatView[] = [
  { id: 'waiting', label: 'Esperando respuesta', filters: { waitingTime: 'any' }, builtIn: true },
  { id: 'urgent', label: 'Más de 1 h sin responder', filters: { waitingTime: 'urgent' }, builtIn: true },
  { id: 'cold', label: 'Sin actividad 7 días', filters: { inactiveDays: 7 }, builtIn: true },
  { id: 'paused', label: 'Bot desactivado', filters: { automationPaused: true }, builtIn: true },
]

export function viewFilters(view: ChatView): ChatFilters {
  return { ...EMPTY_CHAT_FILTERS, ...view.filters }
}

function sameArray<T>(a: readonly T[], b: readonly T[]) {
  if (a.length !== b.length) return false
  const sortedB = [...b].sort()
  return [...a].sort().every((value, index) => value === sortedB[index])
}

export function filtersEqual(a: ChatFilters, b: ChatFilters): boolean {
  return (
    sameArray(a.stages, b.stages)
    && sameArray(a.tagIds, b.tagIds)
    && (a.tagIds.length === 0 || a.tagMode === b.tagMode)
    && a.service === b.service
    && a.sellerId === b.sellerId
    && a.origin === b.origin
    && a.lastSender === b.lastSender
    && a.inactiveDays === b.inactiveDays
    && a.waitingTime === b.waitingTime
    && a.automationPaused === b.automationPaused
  )
}

/** Lo que se guarda de una vista propia: solo lo que difiere de cero. */
export function diffFromEmpty(filters: ChatFilters): Partial<ChatFilters> {
  const result: Partial<ChatFilters> = {}
  for (const key of Object.keys(EMPTY_CHAT_FILTERS) as (keyof ChatFilters)[]) {
    if (key === 'unreadOnly') continue
    const value = filters[key]
    const empty = EMPTY_CHAT_FILTERS[key]
    if (Array.isArray(value) ? value.length > 0 : value !== empty) (result as Record<string, unknown>)[key] = value
  }
  return result
}

const STORAGE_KEY = 'chat-views:v1'
const MAX_CUSTOM_VIEWS = 8

export function loadCustomViews(): ChatView[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as ChatView[]
    return Array.isArray(parsed)
      ? parsed.filter((view) => view && typeof view.id === 'string' && typeof view.label === 'string' && view.filters).slice(0, MAX_CUSTOM_VIEWS)
      : []
  } catch {
    return []
  }
}

export function saveCustomViews(views: ChatView[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(views.slice(0, MAX_CUSTOM_VIEWS)))
  } catch {
    // Sin almacenamiento la vista dura lo que dure la pestaña.
  }
}

export const CUSTOM_VIEWS_LIMIT = MAX_CUSTOM_VIEWS
