import { useOutletContext } from 'react-router-dom'
import type { ChatFilters } from '../leads/types'

export type ChatQuickFilter = 'all' | 'unread' | 'mine'
export type SettingsTab = 'general' | 'usuarios'
/** Anclas de la página de Integraciones. */
export type IntegrationAnchor = 'whatsapp' | 'calendario' | 'erp' | 'voz'

export interface ChatFiltersState {
  search: string
  setSearch: (value: string) => void
  debouncedSearch: string
  chatFilter: ChatQuickFilter
  setChatFilter: (value: ChatQuickFilter) => void
  advancedFilters: ChatFilters
  setAdvancedFilters: (value: ChatFilters) => void
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
