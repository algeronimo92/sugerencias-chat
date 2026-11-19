import { useMemo } from 'react'
import { Select } from '../../../../shared/ui/Input'
import { useInboxCounts } from '../../../leads/public/queries'
import type { ChatFilters, ChatOrder } from '../../../leads/types'
import type { ChatFiltersState } from '../../layoutContext'

const ORDER_LABELS: Record<ChatOrder, string> = {
  recent: 'Más recientes',
  waiting: 'Quién espera más',
}

function withCount(label: string, count: number | undefined) {
  return count === undefined ? label : `${label} ${count}`
}

interface Props {
  filters: ChatFiltersState
  /** Con una búsqueda manda la relevancia: no se ofrece ordenar. */
  searching: boolean
}

/**
 * Cabecera de la lista (doc 18 §6.3): estado de la conversación con cuántas
 * hay, como el "Open 46" de Manychat, y el orden. Los números siguen a la
 * bandeja y a los filtros elegidos, para que coincidan con la lista.
 */
export function ChatListToolbar({ filters, searching }: Props) {
  const { effectiveFilters, conversation, setConversation, order, setOrder } = filters
  const countFilters = useMemo<ChatFilters>(() => ({ ...effectiveFilters, conversation: '' }), [effectiveFilters])
  const { data: counts } = useInboxCounts(countFilters)

  return (
    <div className="mt-2 flex items-center gap-2">
      <Select
        aria-label="Estado de la conversación"
        value={conversation}
        onValueChange={(value) => setConversation(value as ChatFilters['conversation'])}
        className="h-9 min-h-9 flex-1 py-1.5"
      >
        <option value="">{withCount('Todas', counts?.all)}</option>
        <option value="open">{withCount('Abiertas', counts?.open)}</option>
        <option value="closed">{withCount('Cerradas', counts?.closed)}</option>
      </Select>
      {!searching && (
        <Select
          aria-label="Ordenar"
          value={order}
          onValueChange={(value) => setOrder(value as ChatOrder)}
          className="h-9 min-h-9 flex-1 py-1.5"
        >
          {(Object.keys(ORDER_LABELS) as ChatOrder[]).map((key) => (
            <option key={key} value={key}>{ORDER_LABELS[key]}</option>
          ))}
        </Select>
      )}
    </div>
  )
}
