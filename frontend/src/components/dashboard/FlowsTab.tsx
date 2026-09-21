import { AlertTriangle } from 'lucide-react'
import type { DashboardMetrics } from '../../types'
import { AUTOMATION_TRIGGERS } from '../../domain/automationCatalog'
import { formatNumber, formatShortDateTime } from './format'
import { BarList, NoData, Panel, StatGrid, StackedBarList, TrendChart } from './primitives'
import type { StackSegment } from './primitives'

interface Props {
  data: DashboardMetrics
  days: number
  isMine: boolean
  onOpenFlows: () => void
}

// Los mismos nombres que usa el editor de automatizaciones: el vendedor ya los
// vio ahí y en "Flujos enviados".
const TRIGGER_LABELS: Record<string, string> = Object.fromEntries(
  AUTOMATION_TRIGGERS.map((trigger) => [trigger.value, trigger.label]),
)

// El orden es el del ciclo de vida de una ejecución, no el del tamaño: leerlo
// de izquierda a derecha cuenta qué pasó con los envíos.
const SEGMENTS: StackSegment[] = [
  { key: 'completed', label: 'Completados', color: 'bg-viz-done dark:bg-viz-done-dark' },
  { key: 'active', label: 'Activos', color: 'bg-viz-active dark:bg-viz-active-dark' },
  { key: 'skipped', label: 'Omitidos', color: 'bg-viz-idle dark:bg-viz-idle-dark' },
  { key: 'failed', label: 'Fallidos', color: 'bg-viz-failed dark:bg-viz-failed-dark' },
]

function formatLastRun(iso: string | null): string | undefined {
  if (!iso) return undefined
  return `Último: ${formatShortDateTime(iso)}`
}

export function FlowsTab({ data, days, isMine, onOpenFlows }: Props) {
  const { automations } = data
  const period = `Últimos ${days} días`
  const active = automations.active_now
  const activeTotal = Object.values(active).reduce((total, value) => total + value, 0)

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel
        title="Flujos activados por tipo"
        subtitle={isMine ? `Los que yo disparé · ${period}` : `Todo el equipo · ${period}`}
        className="lg:col-span-2"
        action={
          <button
            type="button"
            onClick={onOpenFlows}
            className="shrink-0 text-[11px] font-medium text-wa-primary-strong hover:underline dark:text-wa-primary"
          >
            Ver detalle
          </button>
        }
      >
        <StackedBarList
          segments={SEGMENTS}
          rows={automations.by_flow.map((flow) => ({
            key: String(flow.rule_id),
            label: flow.name,
            sublabel: formatLastRun(flow.last_at),
            total: flow.value,
            parts: {
              completed: flow.completed,
              active: flow.active,
              skipped: flow.skipped,
              failed: flow.failed,
            },
          }))}
          onSelect={onOpenFlows}
        />
      </Panel>

      <Panel title="Quién activó flujos a mano" subtitle={`Ranking del equipo · ${period}`}>
        <BarList items={automations.by_actor} emptyLabel="Nadie disparó flujos a mano" />
      </Panel>

      <Panel title="Cómo arrancaron" subtitle="A mano, por piloto automático o desde otro flujo">
        <BarList items={automations.by_source} emptyLabel="Sin ejecuciones en el período" />
      </Panel>

      <Panel title="Flujos por día" className="lg:col-span-2">
        <TrendChart points={automations.trend} label="Ejecuciones" />
      </Panel>

      <Panel title="Pendientes ahora mismo" subtitle="Sin ventana de tiempo: una espera larga puede venir de antes">
        <StatGrid
          stats={[
            { label: 'Programados', value: formatNumber(active.scheduled ?? 0), hint: 'Esperando su turno' },
            { label: 'En curso', value: formatNumber(active.running ?? 0) },
            { label: 'Pausados', value: formatNumber(active.paused ?? 0), hint: 'Congelados a mano' },
          ]}
        />
        {activeTotal === 0 && <p className="mt-3 text-[11px] text-wa-muted">No hay nada en cola.</p>}
      </Panel>

      <Panel
        title="Fallos"
        subtitle={
          automations.failures.rate != null
            ? `${automations.failures.rate}% de ${formatNumber(automations.failures.total)} ejecuciones`
            : 'Sin ejecuciones en el período'
        }
      >
        {automations.failures.failed === 0 ? (
          <NoData label="Ninguna ejecución falló" />
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {formatNumber(automations.failures.failed)} ejecuciones no llegaron a enviarse
            </div>
            <BarList items={automations.failures.top_errors} />
          </>
        )}
      </Panel>

      <Panel title="Qué los dispara" subtitle="Evento que originó cada ejecución" className="lg:col-span-2">
        <BarList items={automations.by_trigger} labels={TRIGGER_LABELS} emptyLabel="Sin ejecuciones en el período" />
      </Panel>
    </div>
  )
}
