import { useOutletContext } from 'react-router-dom'
import type { ChatFilters, ChatOrder } from '../leads/types'

export type ChatQuickFilter = 'all' | 'unread' | 'mine' | 'unassigned'
export type SettingsTab = 'general' | 'usuarios'
/** Anclas de la página de Integraciones. */
export type IntegrationAnchor = 'whatsapp' | 'calendario' | 'erp' | 'voz' | 'correo'

export interface ChatFiltersState {
  search: string
  setSearch: (value: string) => void
  debouncedSearch: string
  chatFilter: ChatQuickFilter
  setChatFilter: (value: ChatQuickFilter) => void
  advancedFilters: ChatFilters
  setAdvancedFilters: (value: ChatFilters) => void
  /** Abiertas, cerradas o todas. Va aparte de los filtros avanzados: aplicar
   *  una vista o limpiar los filtros no lo toca, como el "Open" de Manychat. */
  conversation: ChatFilters['conversation']
  setConversation: (value: ChatFilters['conversation']) => void
  order: ChatOrder
  setOrder: (value: ChatOrder) => void
  effectiveFilters: ChatFilters
}

export interface LayoutContext {
  chatFilters: ChatFiltersState
  openSettings: (tab?: SettingsTab) => void
  openIntegrations: (anchor?: IntegrationAnchor) => void
  openIssueReport: () => void
}

export function useLayoutContext() {
  return useOutletContext<LayoutContext>()
}
