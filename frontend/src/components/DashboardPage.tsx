import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { ChatFilters, DashboardScope } from '../types'
import { useDashboard } from '../hooks/useDashboard'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'
import { Select } from './ui/Input'
import { FlowsTab } from './dashboard/FlowsTab'
import { PipelineTab } from './dashboard/PipelineTab'
import { SummaryTab } from './dashboard/SummaryTab'
import { TagsTab } from './dashboard/TagsTab'
import { formatRelativeTime } from './dashboard/format'

const TABS = [
  { id: 'summary', label: 'Resumen' },
  { id: 'flows', label: 'Flujos' },
  { id: 'tags', label: 'Etiquetas' },
  { id: 'pipeline', label: 'Embudo y citas' },
] as const

type TabId = (typeof TABS)[number]['id']

interface Props {
  isAdmin: boolean
  onOpenTasks: () => void
  onOpenFlows: () => void
  onOpenChat: (leadId: string) => void
  onFilterChats: (filters: Partial<ChatFilters>) => void
}

export function DashboardPage({ isAdmin, onOpenTasks, onOpenFlows, onOpenChat, onFilterChats }: Props) {
  const [days, setDays] = useState(30)
  // El admin entra viendo el total y el vendedor lo suyo; los dos pueden
  // cambiarlo, y los rankings comparativos llegan igual en ambos scopes.
  const [scope, setScope] = useState<DashboardScope>(isAdmin ? 'team' : 'mine')
  const [tab, setTab] = useState<TabId>('summary')
  const { data, isLoading, isFetching, error, refetch } = useDashboard(days, scope)
  const isMine = scope === 'mine'

  return (
    <div className="h-full overflow-y-auto bg-wa-app p-3 sm:p-6 dark:bg-wa-app-dark">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-wa-text dark:text-white">Dashboard CRM</h1>
            <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
              {isMine ? 'Mis leads, mis flujos y mis citas' : 'Atención, seguimiento y distribución del equipo'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data && (
              <span
                className="text-[11px] text-wa-muted dark:text-wa-muted-dark"
                title={new Date(data.generated_at).toLocaleString('es-PE')}
              >
                Actualizado {formatRelativeTime(data.generated_at)}
              </span>
            )}
            <Button
              variant="secondary"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Actualizar métricas"
              title="Actualizar métricas"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
            <Select
              value={scope}
              onChange={(event) => setScope(event.target.value as DashboardScope)}
              aria-label="Alcance de las métricas"
              className="rounded-lg border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
            >
              <option value="mine">Solo lo mío</option>
              <option value="team">Todo el equipo</option>
            </Select>
            <Select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              aria-label="Período"
              className="rounded-lg border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
            >
              <option value={7}>Últimos 7 días</option>
              <option value={30}>Últimos 30 días</option>
              <option value={90}>Últimos 90 días</option>
            </Select>
          </div>
        </div>

        <div role="tablist" aria-label="Secciones del dashboard" className="mb-5 flex gap-1 overflow-x-auto border-b border-wa-border pb-px dark:border-wa-border-dark">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === item.id
                  ? 'border-wa-primary text-wa-primary-strong dark:text-wa-primary'
                  : 'border-transparent text-wa-muted hover:text-wa-text dark:text-wa-muted-dark dark:hover:text-wa-text-dark'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {isLoading && (
          <div className="flex justify-center py-24">
            <Loader2 className="h-7 w-7 animate-spin text-wa-primary-strong" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            <AlertCircle className="h-4 w-4" /> {extractErrorMessage(error)}
          </div>
        )}

        {data && (
          <div role="tabpanel">
            {tab === 'summary' && (
              <SummaryTab
                data={data}
                days={days}
                isMine={isMine}
                onOpenTasks={onOpenTasks}
                onOpenFlows={onOpenFlows}
                onOpenChat={onOpenChat}
                onFilterChats={onFilterChats}
              />
            )}
            {tab === 'flows' && <FlowsTab data={data} days={days} isMine={isMine} onOpenFlows={onOpenFlows} />}
            {tab === 'tags' && <TagsTab data={data} days={days} isMine={isMine} onFilterChats={onFilterChats} />}
            {tab === 'pipeline' && (
              <PipelineTab data={data} days={days} isMine={isMine} onFilterChats={onFilterChats} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
