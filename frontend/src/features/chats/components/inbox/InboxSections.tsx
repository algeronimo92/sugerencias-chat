import { AlarmClock, CircleDot, Clock, Inbox, Moon, User, Users, ZapOff, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { FilterItem, FilterSection } from '../../../../shared/ui/FilterPanel'
import { useInboxCounts } from '../../../leads/public/queries'
import { useLeadStageCatalog } from '../../../leads/public/useLeadStages'
import { EMPTY_CHAT_FILTERS } from '../../../leads/types'
import { inboxCountFilters } from '../../domain/inboxCounts'
import { BUILT_IN_VIEWS, filtersEqual, viewFilters } from '../../domain/savedViews'
import type { ChatFiltersState, ChatQuickFilter } from '../../layoutContext'
import { CustomViewsSection } from './CustomViewsSection'

const VIEW_ICONS: Record<string, LucideIcon> = { waiting: Clock, urgent: AlarmClock, cold: Moon, paused: ZapOff }

interface Props {
  filters: ChatFiltersState
}

/**
 * Las secciones de bandejas (Conversaciones, Atención, Etapas, Mis vistas)
 * con cuántos chats hay en cada una (doc 18 §5.2). Las comparten la columna
 * de escritorio (InboxPanel) y la hoja inferior del celular (InboxSheet).
 */
export function InboxSections({ filters }: Props) {
  const { chatFilter, setChatFilter, advancedFilters, setAdvancedFilters } = filters
  const countFilters = useMemo(() => inboxCountFilters(advancedFilters), [advancedFilters])
  const { data: counts } = useInboxCounts(countFilters)
  const { active: stages } = useLeadStageCatalog()

  // El backend aplica el alcance configurado también a "Todas". Ocultarla
  // por rol dejaría a los vendedores sin salida de "Mías" aun con el ajuste apagado.
  const inboxes: { id: ChatQuickFilter; label: string; icon: LucideIcon; count: number | null | undefined }[] = [
    { id: 'unassigned', label: 'Sin asignar', icon: Inbox, count: counts?.unassigned ?? null },
    { id: 'mine', label: 'Mías', icon: User, count: counts?.mine ?? null },
    { id: 'all', label: 'Todas', icon: Users, count: counts?.all ?? null },
  ]

  function toggleView(viewId: string) {
    const view = BUILT_IN_VIEWS.find((item) => item.id === viewId)
    if (!view) return
    setAdvancedFilters(filtersEqual(advancedFilters, viewFilters(view)) ? EMPTY_CHAT_FILTERS : viewFilters(view))
  }

  function toggleStage(key: string) {
    const only = advancedFilters.stages.length === 1 && advancedFilters.stages[0] === key
    setAdvancedFilters({ ...advancedFilters, stages: only ? [] : [key] })
  }

  return (
    <>
    <FilterSection title="Conversaciones">
      {inboxes.map((inbox) => (
        <FilterItem
          key={inbox.id}
          label={inbox.label}
          icon={inbox.icon}
          count={inbox.count}
          selected={chatFilter === inbox.id}
          onSelect={() => setChatFilter(inbox.id)}
        />
      ))}
    </FilterSection>

    <FilterSection title="Atención" collapsible storageKey="inbox-section-attention">
      <FilterItem
        label="No leídos"
        icon={CircleDot}
        count={counts?.unread ?? null}
        selected={chatFilter === 'unread'}
        onSelect={() => setChatFilter(chatFilter === 'unread' ? 'all' : 'unread')}
      />
      {BUILT_IN_VIEWS.map((view) => (
        <FilterItem
          key={view.id}
          label={view.label}
          icon={VIEW_ICONS[view.id]}
          // Solo "Esperando respuesta" tiene su número en el backend: las
          // demás no muestran uno inventado.
          count={view.id === 'waiting' ? (counts?.waiting ?? null) : undefined}
          selected={filtersEqual(advancedFilters, viewFilters(view))}
          onSelect={() => toggleView(view.id)}
        />
      ))}
    </FilterSection>

    <FilterSection title="Etapas" collapsible storageKey="inbox-section-stages">
      {stages.map((stage) => (
        <FilterItem
          key={stage.key}
          label={stage.name}
          color={stage.color}
          count={counts ? (counts.stages[stage.key] ?? 0) : null}
          selected={advancedFilters.stages.length === 1 && advancedFilters.stages[0] === stage.key}
          onSelect={() => toggleStage(stage.key)}
        />
      ))}
    </FilterSection>

    <CustomViewsSection filters={advancedFilters} onChange={setAdvancedFilters} />
    </>
  )
}
