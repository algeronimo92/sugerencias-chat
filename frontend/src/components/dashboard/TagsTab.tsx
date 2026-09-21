import type { ChatFilters, DashboardMetrics } from '../../types'
import { formatNumber } from './format'
import { BarList, Panel, StatGrid, TagBarList, TrendChart } from './primitives'

interface Props {
  data: DashboardMetrics
  days: number
  isMine: boolean
  onFilterChats: (filters: Partial<ChatFilters>) => void
}

export function TagsTab({ data, days, isMine, onFilterChats }: Props) {
  const { coverage, top, by_user, trend } = data.tags
  const scopeLabel = isMine ? 'Entre mis leads' : 'Entre todos los leads'

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Cobertura de etiquetado" subtitle={scopeLabel} className="lg:col-span-2">
        <StatGrid
          stats={[
            {
              label: 'Leads etiquetados',
              value: formatNumber(coverage.tagged),
              hint: coverage.rate != null ? `${coverage.rate}% del total` : undefined,
            },
            { label: 'Sin ninguna etiqueta', value: formatNumber(coverage.untagged) },
            { label: 'Leads en total', value: formatNumber(coverage.total) },
          ]}
        />
        {coverage.total > 0 && (
          <div className="mt-4">
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-wa-field dark:bg-wa-head-dark">
              <span
                className="h-full rounded-l-full bg-viz-done dark:bg-viz-done-dark"
                style={{ width: `${(coverage.tagged / coverage.total) * 100}%` }}
              />
              <span
                className="h-full rounded-r-full bg-viz-idle dark:bg-viz-idle-dark"
                style={{ width: `${(coverage.untagged / coverage.total) * 100}%` }}
              />
            </div>
            <ul className="mt-2 flex gap-4 text-[11px] text-wa-muted dark:text-wa-muted-dark">
              <li className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-viz-done dark:bg-viz-done-dark" aria-hidden="true" />
                Etiquetados
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-viz-idle dark:bg-viz-idle-dark" aria-hidden="true" />
                Sin etiqueta
              </li>
            </ul>
          </div>
        )}
      </Panel>

      <Panel title="Etiquetas más usadas" subtitle="Cuántos leads tiene cada una">
        <TagBarList items={top} onSelect={(tagId) => onFilterChats({ tagIds: [tagId] })} />
      </Panel>

      <Panel title="Quién etiqueta" subtitle={`Ranking del equipo · Últimos ${days} días`}>
        <BarList items={by_user} emptyLabel="Nadie etiquetó en el período" />
      </Panel>

      <Panel title="Etiquetas aplicadas por día" className="lg:col-span-2">
        <TrendChart points={trend} label="Etiquetas" />
      </Panel>
    </div>
  )
}
