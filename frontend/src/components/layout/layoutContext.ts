import { useOutletContext } from 'react-router-dom'
import type { ChatFilters } from '../../types'

export type ChatQuickFilter = 'all' | 'unread' | 'mine'
export type SettingsTab = 'claves' | 'whatsapp' | 'usuarios'

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
  openIssueReport: () => void
}

export function useLayoutContext() {
  return useOutletContext<LayoutContext>()
}
