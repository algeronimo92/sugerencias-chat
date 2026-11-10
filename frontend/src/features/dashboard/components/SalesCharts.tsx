import { useState } from 'react'
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis,
} from 'recharts'
import type { DashboardAmountPoint } from '../types'
import { formatDayLabel, formatMoney, formatNumber } from './format'
import type { Change } from './salesFormat'
import { compareSeries } from './salesFormat'

// El período anterior va en gris: es contexto, no una segunda serie que
// compita con la actual. Es el mismo neutro en claro y oscuro (--color-viz-idle).
const PREVIOUS_STROKE = '#8696a0'

const CHANGE_CLASSES = {
  good: 'text-wa-primary-strong dark:text-wa-primary',
  bad: 'text-red-600 dark:text-red-400',
  // Para un descuento que sube: alerta, no error.
  warn: 'text-viz-3 dark:text-viz-3-dark',
  neutral: 'text-wa-muted dark:text-wa-muted-dark',
}

/** Color del cambio según si subir es bueno (ingresos) o malo (descuentos). */
function changeClass(change: Change, upIsBad: boolean): string {
  if (change.direction === 'up') return upIsBad ? CHANGE_CLASSES.warn : CHANGE_CLASSES.good
  if (change.direction === 'down') return upIsBad ? CHANGE_CLASSES.good : CHANGE_CLASSES.bad
  return CHANGE_CLASSES.neutral
}

export function ChangeLabel({ change, upIsBad = false, suffix }: { change: Change; upIsBad?: boolean; suffix?: string }) {
  const shown = change.direction === 'up' || change.direction === 'down'
  return (
    <span className={`text-xs ${shown ? 'font-medium' : ''} ${changeClass(change, upIsBad)}`}>
      <span>{change.label}</span>
      {shown && suffix && <span className="font-normal text-wa-muted dark:text-wa-muted-dark"> {suffix}</span>}
    </span>
  )
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const width = 72
  const height = 26
  const max = Math.max(...values, 1)
  const points = values.map((value, index) => [
    (index / (values.length - 1)) * width,
    height - 2 - (value / max) * (height - 4),
  ])
  const path = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')
  const [lastX, lastY] = points.at(-1)!
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[26px] w-[72px] shrink-0 text-viz-1 dark:text-viz-1-dark" aria-hidden="true">
      <path d={`${path}L${width} ${height}L0 ${height}Z`} fill="currentColor" fillOpacity={0.1} />
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill="currentColor" />
    </svg>
  )
}

interface StatTileProps {
  label: string
  value: string
  change: Change
  upIsBad?: boolean
  hint?: string
  trend?: number[]
}

/** Cifra con su cambio contra la ventana anterior y, si aporta, la forma de la
 *  serie. La sparkline no lleva ejes: el detalle está en el gráfico grande. */
export function StatTile({ label, value, change, upIsBad, hint, trend }: StatTileProps) {
  return (
    <div className="min-w-0 rounded-xl border border-wa-border bg-white p-4 shadow-sm dark:border-wa-border-dark dark:bg-wa-panel-dark">
      <p className="text-xs font-medium text-wa-muted dark:text-wa-muted-dark">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold text-wa-text dark:text-white">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-wa-muted">{hint}</p>}
      <div className="mt-2 flex items-end justify-between gap-2">
        <ChangeLabel change={change} upIsBad={upIsBad} suffix="vs. anterior" />
        {trend && <Sparkline values={trend} />}
      </div>
    </div>
  )
}

interface TrendProps {
  current: DashboardAmountPoint[]
  previous: DashboardAmountPoint[]
  days: number
  currency: string | null
  /** Cómo se llaman las dos medidas: "Monto" y "Separaciones" para citas. */
  labels?: { revenue: string; count: string }
}

const DEFAULT_LABELS = { revenue: 'Ingresos', count: 'Compras' }

export function SalesTrendChart({ current, previous, days, currency, labels = DEFAULT_LABELS }: TrendProps) {
  const [metric, setMetric] = useState<'revenue' | 'count'>('revenue')
  const weekly = days >= 90
  const points = compareSeries(current, previous, metric, weekly ? 7 : 1)
  const format = (value: number) => (metric === 'revenue' ? formatMoney(value, currency) : formatNumber(value))
  const tickFormat = (value: number) =>
    metric === 'revenue' && value >= 1000
      ? `${(value / 1000).toLocaleString('es-PE', { maximumFractionDigits: 1 })} mil`
      : formatNumber(value)
  const rangeLabel = (start: string, end?: string) =>
    end && end !== start ? `${formatDayLabel(start)} – ${formatDayLabel(end)}` : formatDayLabel(start)
  const metricLabel = labels[metric]

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">
          <li className="flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 rounded-full bg-viz-1 dark:bg-viz-1-dark" aria-hidden="true" />
            Últimos {days} días
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 rounded-full bg-viz-idle" aria-hidden="true" />
            {days} días anteriores
          </li>
        </ul>
        <div role="group" aria-label="Métrica de la tendencia" className="inline-flex rounded-lg bg-wa-field p-0.5 dark:bg-wa-head-dark">
          {(['revenue', 'count'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={metric === option}
              onClick={() => setMetric(option)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                metric === option
                  ? 'bg-white font-semibold text-wa-text shadow-sm dark:bg-wa-panel-dark dark:text-white'
                  : 'text-wa-muted hover:text-wa-text dark:text-wa-muted-dark dark:hover:text-wa-text-dark'
              }`}
            >
              {labels[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="h-56 w-full text-viz-1 dark:text-viz-1-dark" role="img" aria-label={`${metricLabel} ${weekly ? 'por semana' : 'por día'} frente al período anterior`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke={PREVIOUS_STROKE} strokeOpacity={0.2} />
            <XAxis dataKey="date" hide />
            <YAxis
              width={52}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: PREVIOUS_STROKE }}
              tickFormatter={tickFormat}
              allowDecimals={false}
            />
            <ChartTooltip
              cursor={{ stroke: PREVIOUS_STROKE }}
              // Colores del tema (index.css): con un fondo blanco fijo el
              // tooltip se veía claro en modo oscuro y el texto, del color
              // de la serie, no se leía.
              contentStyle={{ borderRadius: 10, borderColor: 'var(--viz-border)', background: 'var(--viz-surface)', color: 'var(--viz-text)', boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)', fontSize: 12 }}
              itemStyle={{ color: 'var(--viz-text)' }}
              labelStyle={{ color: 'var(--viz-muted)' }}
              labelFormatter={(_, payload) => {
                const point = payload?.[0]?.payload as (typeof points)[number] | undefined
                return point ? rangeLabel(point.date, point.endDate) : ''
              }}
              formatter={(value, name, item) => {
                const point = item.payload as (typeof points)[number]
                if (name === 'previous') return [format(Number(value)), `Anterior (${formatDayLabel(point.previousDate)})`]
                return [format(Number(value)), metricLabel]
              }}
            />
            <Area
              type="monotone"
              dataKey="current"
              stroke="currentColor"
              strokeWidth={2}
              fill="currentColor"
              fillOpacity={0.1}
              activeDot={{ r: 4, fill: 'currentColor' }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="previous"
              stroke={PREVIOUS_STROKE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: PREVIOUS_STROKE }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between pl-[52px] text-[10px] text-wa-muted">
        <span>{points[0] ? formatDayLabel(points[0].date) : ''}</span>
        <span>{points.at(-1) ? formatDayLabel(points.at(-1)!.endDate ?? points.at(-1)!.date) : ''}</span>
      </div>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-wa-muted dark:text-wa-muted-dark">Ver como tabla</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left">
            <thead className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
              <tr>
                <th scope="col" className="py-1 font-medium">{weekly ? 'Semana' : 'Día'}</th>
                <th scope="col" className="py-1 text-right font-medium">Período</th>
                <th scope="col" className="py-1 text-right font-medium">Anterior</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-gray-700 dark:text-gray-300">
              {points.map((point) => (
                <tr key={point.date} className="border-t border-wa-border dark:border-wa-border-dark">
                  <td className="py-1">{rangeLabel(point.date, point.endDate)}</td>
                  <td className="py-1 text-right">{format(point.current)}</td>
                  <td className="py-1 text-right">{format(point.previous)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
