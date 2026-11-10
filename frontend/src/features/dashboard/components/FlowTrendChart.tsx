import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip } from 'recharts'
import type { DashboardPoint } from '../types'
import { formatDayLabel, formatNumber } from './format'

const SERIES = [
  { key: 'manual', label: 'A mano', color: 'var(--viz-cat-1)', dash: undefined },
  // Punteada además de otro color: la serie no depende solo del tono.
  { key: 'automatic', label: 'Automáticos', color: 'var(--viz-cat-2)', dash: '5 3' },
] as const

/** "Flujos por día" partido en a mano y automáticos, apilados: la altura total
 *  sigue siendo la de siempre y se ve qué parte sostuvo cada uno. */
export function FlowTrendChart({ manual, automatic }: { manual: DashboardPoint[]; automatic: DashboardPoint[] }) {
  const automaticByDate = new Map(automatic.map(point => [point.date, point.value]))
  const points = manual.map(point => ({ date: point.date, manual: point.value, automatic: automaticByDate.get(point.date) ?? 0 }))
  const totals = { manual: points.reduce((sum, point) => sum + point.manual, 0), automatic: points.reduce((sum, point) => sum + point.automatic, 0) }

  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">
        {SERIES.map(series => (
          <li key={series.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: series.color }} aria-hidden="true" />
            {series.label}
            <span className="font-semibold tabular-nums text-wa-text dark:text-wa-text-dark">{formatNumber(totals[series.key])}</span>
          </li>
        ))}
      </ul>
      <div className="h-48 w-full" role="img" aria-label={`Flujos por día: ${formatNumber(totals.manual)} a mano y ${formatNumber(totals.automatic)} automáticos en el período`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 8 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
            <ChartTooltip
              cursor={{ stroke: '#8696a0', strokeDasharray: '3 3' }}
              labelFormatter={date => formatDayLabel(String(date))}
              formatter={(value, name) => [formatNumber(Number(value)), SERIES.find(series => series.key === name)?.label ?? String(name)]}
              contentStyle={{ borderRadius: 10, borderColor: 'var(--viz-border)', background: 'var(--viz-surface)', color: 'var(--viz-text)', boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)', fontSize: 12 }}
              itemStyle={{ color: 'var(--viz-text)' }}
              labelStyle={{ color: 'var(--viz-muted)' }}
            />
            {SERIES.map(series => (
              <Area
                key={series.key}
                type="monotone"
                dataKey={series.key}
                stackId="flows"
                stroke={series.color}
                strokeWidth={2}
                strokeDasharray={series.dash}
                fill={series.color}
                fillOpacity={0.18}
                activeDot={{ r: 4 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between text-[10px] text-wa-muted">
        <span>{points[0] ? formatDayLabel(points[0].date) : ''}</span>
        <span>{points.at(-1) ? formatDayLabel(points.at(-1)!.date) : ''}</span>
      </div>
    </div>
  )
}
