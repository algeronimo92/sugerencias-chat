import { useEffect, useRef, useState } from 'react'
import type { ChatFiltersState, ChatQuickFilter } from '../layoutContext'
import type { ChatFilters } from '../../leads/types'
import { EMPTY_CHAT_FILTERS } from '../../leads/types'

const SEARCH_DEBOUNCE_MS = 300

export function useChatFiltersState(currentUserId: number | null, role?: string): ChatFiltersState {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [chatFilter, setChatFilter] = useState<ChatQuickFilter>('all')
  const [advancedFilters, setAdvancedFilters] = useState<ChatFilters>(EMPTY_CHAT_FILTERS)

  // La vendedora arranca en sus chats (decisión 1 del doc 18). El rol llega
  // con la sesión, después del primer render: se aplica una sola vez, para no
  // pisar la bandeja que ella elija después.
  const appliedRoleDefault = useRef(false)
  useEffect(() => {
    if (appliedRoleDefault.current || !role) return
    appliedRoleDefault.current = true
    if (role === 'vendedor') setChatFilter('mine')
  }, [role])

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
    sellerId: chatFilter === 'mine' ? currentUserId : chatFilter === 'unassigned' ? null : advancedFilters.sellerId,
    unassigned: chatFilter === 'unassigned',
  }

  return {
    search, setSearch, debouncedSearch, chatFilter, setChatFilter, advancedFilters, setAdvancedFilters, effectiveFilters,
  }
}
