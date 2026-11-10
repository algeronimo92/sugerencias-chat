import { AlertCircle, Link2, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { ChatFilters } from '../../leads/types'
import type { DashboardScope } from '../types'
import { useDashboard } from '../hooks/useDashboard'
import { useDashboardFilters, type DashboardView, type TabId } from '../hooks/useDashboardFilters'
import { useSellers } from '../../platform/public/useUsers'
import { who, type DashboardSubject } from './subject'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { Button } from '../../../shared/ui/Button'
import { Select } from '../../../shared/ui/Input'
import { FlowsTab } from './FlowsTab'
import { PipelineTab } from './PipelineTab'
import { SalesTab } from './SalesTab'
import { SummaryTab } from './SummaryTab'
import { TagsTab } from './TagsTab'
import { formatRelativeTime } from './format'

const TABS: { id: TabId; label: string }[] = [
  { id: 'summary', label: 'Resumen' },
  { id: 'flows', label: 'Flujos' },
  { id: 'tags', label: 'Etiquetas' },
  { id: 'pipeline', label: 'Embudo y citas' },
  { id: 'sales', label: 'Ventas' },
]

const SELECT_CLASS = 'rounded-lg border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark'

/** El selector mezcla alcances y personas: una vendedora va como "vendedora:12". */
function viewValue(view: DashboardView): string {
  return typeof view === 'number' ? `vendedora:${view}` : view
}

function parseView(value: string): DashboardView {
  if (value.startsWith('vendedora:')) return Number(value.slice('vendedora:'.length))
  return value === 'mine' ? 'mine' : 'team'
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    toast.success('Enlace copiado', { description: 'Quien lo abra verá esta misma pestaña, período y persona.' })
  } catch {
    toast.error('No se pudo copiar el enlace', { description: 'Cópialo desde la barra de direcciones.' })
  }
}

interface Props {
  isAdmin: boolean
  onOpenTasks: () => void
  onOpenFlows: () => void
  onOpenChat: (leadId: string) => void
  onFilterChats: (filters: Partial<ChatFilters>) => void
}

export function DashboardPage({ isAdmin, onOpenTasks, onOpenFlows, onOpenChat, onFilterChats }: Props) {
  const { tab, setTab, days, setDays, view, setView } = useDashboardFilters(isAdmin)
  // Solo el admin puede mirar a otra persona: la lista se pide solo para él.
  const sellersQuery = useSellers({ enabled: isAdmin })
  const sellers = isAdmin ? sellersQuery.data ?? [] : []
  const sellerId = typeof view === 'number' ? view : null
  const scope: DashboardScope = view === 'team' ? 'team' : 'mine'
  const { data, isLoading, isFetching, isPlaceholderData, error, refetch } = useDashboard(days, sellerId ? null : scope, sellerId)
  const sellerName = sellerId ? sellers.find((seller) => seller.id === sellerId)?.name ?? 'esta persona' : null
  const subject: DashboardSubject = sellerName ? { kind: 'seller', name: sellerName } : view === 'mine' ? { kind: 'me' } : { kind: 'team' }

  return (
    <div className="h-full overflow-y-auto bg-wa-app p-3 sm:p-6 dark:bg-wa-app-dark">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-wa-text dark:text-white">Dashboard CRM</h1>
            <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
              {who(subject, {
                me: 'Mis leads, mis flujos y mis citas',
                team: 'Atención, seguimiento y distribución del equipo',
                seller: (name) => `Leads, flujos y citas de ${name}`,
              })}
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
            <Button variant="secondary" size="sm" onClick={() => void copyLink()} title="Copiar el enlace de esta vista">
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
              Copiar enlace
            </Button>
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
              value={viewValue(view)}
              onChange={(event) => setView(parseView(event.target.value))}
              aria-label="De quién son las métricas"
              className={SELECT_CLASS}
            >
              <option value="mine">Solo lo mío</option>
              <option value="team">Todo el equipo</option>
              {sellers.map((seller) => (
                <option key={seller.id} value={`vendedora:${seller.id}`}>{seller.name}</option>
              ))}
              {/* Un enlace compartido con alguien que ya no está en la lista
                  igual tiene que mostrar a quién se mira. */}
              {sellerId && !sellers.some((seller) => seller.id === sellerId) && (
                <option value={`vendedora:${sellerId}`}>{sellerName}</option>
              )}
            </Select>
            <Select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              aria-label="Período"
              className={SELECT_CLASS}
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
          // Al cambiar de período se conserva el render anterior atenuado: un
          // spinner a pantalla completa haría saltar la página en cada cambio.
          <div role="tabpanel" aria-busy={isFetching} className={`transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`}>
            {tab === 'summary' && (
              <SummaryTab
                data={data}
                days={days}
                subject={subject}
                onOpenTasks={onOpenTasks}
                onOpenFlows={onOpenFlows}
                onOpenChat={onOpenChat}
                onFilterChats={onFilterChats}
                onOpenSales={() => setTab('sales')}
              />
            )}
            {tab === 'flows' && <FlowsTab data={data} days={days} subject={subject} onOpenFlows={onOpenFlows} />}
            {tab === 'tags' && <TagsTab data={data} days={days} subject={subject} onFilterChats={onFilterChats} />}
            {tab === 'pipeline' && (
              <PipelineTab data={data} days={days} subject={subject} onFilterChats={onFilterChats} />
            )}
            {tab === 'sales' && <SalesTab data={data} days={days} subject={subject} onOpenChat={onOpenChat} />}
          </div>
        )}
      </div>
    </div>
  )
}
