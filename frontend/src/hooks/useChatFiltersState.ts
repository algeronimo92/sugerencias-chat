import { useEffect, useState } from 'react'
import { EMPTY_CHAT_FILTERS, type ChatFilters } from '../types'
import type { ChatFiltersState, ChatQuickFilter } from '../components/layout/layoutContext'

const SEARCH_DEBOUNCE_MS = 300

export function useChatFiltersState(currentUserId: number | null): ChatFiltersState {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [chatFilter, setChatFilter] = useState<ChatQuickFilter>('all')
  const [advancedFilters, setAdvancedFilters] = useState<ChatFilters>(EMPTY_CHAT_FILTERS)

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [search])

  const effectiveFilters: ChatFilters = {
    ...advancedFilters,
    unreadOnly: chatFilter === 'unread',
    // "Mis leads" pisa el filtro de vendedor de los avanzados mientras está
    // activo — no tiene sentido combinarlos, y así al desactivarlo se
    // vuelve solo al filtro avanzado que el usuario haya dejado cargado.
    sellerId: chatFilter === 'mine' ? currentUserId : advancedFilters.sellerId,
  }

  return {
    search, setSearch, debouncedSearch, chatFilter, setChatFilter, advancedFilters, setAdvancedFilters, effectiveFilters,
  }
}
