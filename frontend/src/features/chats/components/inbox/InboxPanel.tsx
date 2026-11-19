import { AlarmClock, CircleDot, Clock, Inbox, Moon, PanelLeftClose, User, Users, ZapOff, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { FilterItem, FilterSection } from '../../../../shared/ui/FilterPanel'
import { Tooltip } from '../../../../shared/ui/Tooltip'
import { useInboxCounts } from '../../../leads/public/queries'
import { useLeadStageCatalog } from '../../../leads/public/useLeadStages'
import { EMPTY_CHAT_FILTERS } from '../../../leads/types'
import { inboxCountFilters } from '../../domain/inboxCounts'
import { CustomViewsSection } from './CustomViewsSection'
import { BUILT_IN_VIEWS, filtersEqual, viewFilters } from '../../domain/savedViews'
import type { ChatFiltersState, ChatQuickFilter } from '../../layoutContext'

const VIEW_ICONS: Record<string, LucideIcon> = { waiting: Clock, urgent: AlarmClock, cold: Moon, paused: ZapOff }

interface Props {
  role: string | undefined
  filters: ChatFiltersState
  onCollapse: () => void
}

/**
 * Panel de bandejas a la izquierda de la lista de chats, como el de Manychat
 * (doc 18 §5.2 y §6.3): quién atiende, qué necesita atención y en qué etapa
 * está cada chat, con cuántos hay en cada uno. Reemplaza en escritorio a los
 * chips de vistas rápidas de la lista.
 */
export function InboxPanel({ role, filters, onCollapse }: Props) {
  const { chatFilter, setChatFilter, advancedFilters, setAdvancedFilters } = filters
  const countFilters = useMemo(() => inboxCountFilters(advancedFilters), [advancedFilters])
  const { data: counts } = useInboxCounts(countFilters)
  const { active: stages } = useLeadStageCatalog()

  // La vendedora ve sus chats y los sin asignar; "Todas" es del admin
  // (decisión 1 del doc 18).
  const inboxes: { id: ChatQuickFilter; label: string; icon: LucideIcon; count: number | null | undefined }[] = [
    { id: 'unassigned', label: 'Sin asignar', icon: Inbox, count: counts?.unassigned ?? null },
    { id: 'mine', label: 'Mías', icon: User, count: counts?.mine ?? null },
    ...(role === 'vendedor' ? [] : [{ id: 'all' as const, label: 'Todas', icon: Users, count: counts?.all ?? null }]),
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
    <nav aria-label="Bandejas" className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-5">
        <h2 className="text-base font-semibold text-fg">Bandejas</h2>
        <Tooltip content="Ocultar bandejas" side="right">
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Ocultar bandejas"
            className="-mr-2 flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted outline-none transition-colors hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PanelLeftClose className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
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
      </div>
    </nav>
  )
}
