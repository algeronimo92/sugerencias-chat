import { useEffect, useState } from 'react'
import type { ChatFiltersState, ChatQuickFilter } from '../layoutContext'
import type { ChatFilters, ChatOrder } from '../../leads/types'
import { EMPTY_CHAT_FILTERS } from '../../leads/types'

const SEARCH_DEBOUNCE_MS = 300

export function useChatFiltersState(currentUserId: number | null): ChatFiltersState {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  // "Todas" muestra lo que permite el negocio. El backend limita el alcance
  // cuando está activa la opción de ver solo asignados; el rol no añade un
  // filtro "Mías" que siga escondiendo leads al desactivar esa opción.
  const [chatFilter, setChatFilter] = useState<ChatQuickFilter>('all')
  const [advancedFilters, setAdvancedFilters] = useState<ChatFilters>(EMPTY_CHAT_FILTERS)
  const [conversation, setConversation] = useState<ChatFilters['conversation']>('')
  const [order, setOrder] = useState<ChatOrder>('recent')

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
    conversation,
  }

  return {
    search, setSearch, debouncedSearch, chatFilter, setChatFilter, advancedFilters, setAdvancedFilters,
    conversation, setConversation, order, setOrder, effectiveFilters,
  }
}
