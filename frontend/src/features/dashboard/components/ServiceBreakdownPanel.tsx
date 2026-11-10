import { useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer,
  Tooltip as ChartTooltip, XAxis, YAxis,
} from 'recharts'
import type { DashboardMetrics } from '../types'
import { formatDayLabel, formatMoney, formatNumber } from './format'
import { NoData } from './primitives'
import type { ServiceBucket, ServiceMetric } from './serviceBreakdown'
import { bucketDays, buildBuckets, fromAppointments, headline, pickSeries, shares } from './serviceBreakdown'

const AXIS = '#8696a0'
const TOOLTIP_STYLE = {
  borderRadius: 10,
  borderColor: 'var(--viz-border)',
  background: 'var(--viz-surface)',
  color: 'var(--viz-text)',
  boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)',
  fontSize: 12,
}
// El texto va en el color del texto y no en el de la serie: un amarillo o un
// rosa sobre fondo claro no se lee; el color lo da el punto de la leyenda.
const TOOLTIP_ITEM = { color: 'var(--viz-text)', padding: '1px 0' }
const TOOLTIP_LABEL = { color: 'var(--viz-muted)', marginBottom: 4 }

function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })
}

function rangeLabel(bucket: ServiceBucket): string {
  const range = bucket.start === bucket.end ? formatDayLabel(bucket.start) : `${shortDay(bucket.start)} – ${shortDay(bucket.end)}`
  return bucket.partialDays ? `${range} (solo ${bucket.partialDays} ${bucket.partialDays === 1 ? 'día' : 'días'})` : range
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-wa-field p-0.5 dark:bg-wa-head-dark">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            value === option.value
              ? 'bg-white font-semibold text-wa-text shadow-sm dark:bg-wa-panel-dark dark:text-white'
              : 'text-wa-muted hover:text-wa-text dark:text-wa-muted-dark dark:hover:text-wa-text-dark'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Cuánto se separó de cada tratamiento en cada día o semana del período, y
 *  qué parte del total fue cada uno. Barras apiladas para ver el volumen y la
 *  mezcla a la vez, líneas para comparar la tendencia de cada tratamiento sin
 *  que se tapen, y la torta para el reparto del período. */
export function ServiceBreakdownPanel({ data, days }: { data: DashboardMetrics; days: number }) {
  const [chosenMetric, setMetric] = useState<ServiceMetric>('count')
  const [view, setView] = useState<'bars' | 'lines'>('bars')
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const source = fromAppointments(data)
  const metric: ServiceMetric = source.hasRevenue ? chosenMetric : 'count'

  if (source.ranking.length === 0) return <NoData label="Sin separaciones en el período" />

  const allSeries = pickSeries(source)
  const series = allSeries.filter((item) => !hidden.has(item.key))
  const size = bucketDays(days)
  const buckets = buildBuckets(source, allSeries, metric, size)
  const visibleBuckets = buckets.map((bucket) => ({
    ...bucket,
    total: series.reduce((sum, item) => sum + (bucket.values[item.key] ?? 0), 0),
  }))
  const chartData = visibleBuckets.map((bucket) => ({ ...bucket.values, label: `${shortDay(bucket.start)}${bucket.partialDays ? '*' : ''}`, bucket }))
  const pie = shares(visibleBuckets, series)
  const format = (value: number) => (metric === 'revenue' ? formatMoney(value, data.currency) : formatNumber(value))
  const tick = (value: number) =>
    metric === 'revenue' && value >= 1000 ? `${(value / 1000).toLocaleString('es-PE', { maximumFractionDigits: 1 })} mil` : formatNumber(value)
  const unit = size === 1 ? 'día' : 'semana'
  const summary = headline(pie, format, source.verb)
  const partial = visibleBuckets.find((bucket) => bucket.partialDays)

  function toggle(key: string) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else if (next.size < allSeries.length - 1) next.add(key) // siempre queda al menos uno
      return next
    })
  }

  const tooltip = (
    <ChartTooltip
      contentStyle={TOOLTIP_STYLE}
      itemStyle={TOOLTIP_ITEM}
      labelStyle={TOOLTIP_LABEL}
      cursor={view === 'bars' ? { fill: AXIS, fillOpacity: 0.08 } : { stroke: AXIS }}
      labelFormatter={(_, payload) => {
        const bucket = (payload?.[0]?.payload as { bucket?: ServiceBucket } | undefined)?.bucket
        return bucket ? `${rangeLabel(bucket)} · total ${format(bucket.total)}` : ''
      }}
      formatter={(value, key) => [format(Number(value)), allSeries.find((item) => item.key === key)?.name ?? String(key)]}
      itemSorter={(item) => -Number(item.value)}
    />
  )

  return (
    <div>
      {summary && <p className="mb-3 text-sm font-medium text-gray-800 dark:text-wa-text-dark">{summary}</p>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {source.hasRevenue && (
          <Segmented label="Medida" value={metric} onChange={setMetric}
            options={[{ value: 'count', label: 'Cantidad' }, { value: 'revenue', label: source.revenueLabel }]} />
        )}
        <Segmented label="Tipo de gráfico" value={view} onChange={setView}
          options={[{ value: 'bars', label: 'Barras apiladas' }, { value: 'lines', label: 'Líneas' }]} />
      </div>

      <ul aria-label="Tratamientos (toca uno para ocultarlo o mostrarlo)" className="mb-3 flex flex-wrap gap-1.5">
        {allSeries.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              aria-pressed={!hidden.has(item.key)}
              onClick={() => toggle(item.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border border-wa-border px-2.5 py-1 text-xs text-gray-700 transition-opacity dark:border-wa-border-dark dark:text-gray-200 ${
                hidden.has(item.key) ? 'opacity-45' : ''
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} aria-hidden="true" />
              {item.name}
            </button>
          </li>
        ))}
      </ul>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="h-64 min-w-0" role="img" aria-label={`${metric === 'revenue' ? 'Ingresos' : 'Compras'} por ${unit} y tratamiento`}>
          <ResponsiveContainer width="100%" height="100%">
            {view === 'bars' ? (
              <BarChart data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} accessibilityLayer>
                <CartesianGrid vertical={false} stroke={AXIS} strokeOpacity={0.2} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: AXIS }} interval="preserveStartEnd" />
                <YAxis width={48} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: AXIS }} tickFormatter={tick} allowDecimals={false} />
                {tooltip}
                {series.map((item, index) => (
                  <Bar
                    key={item.key}
                    dataKey={item.key}
                    stackId="servicios"
                    fill={item.color}
                    maxBarSize={36}
                    // 2px del color de la superficie entre segmentos: el color
                    // solo no alcanza para separar dos tratamientos vecinos.
                    stroke="var(--viz-surface)"
                    strokeWidth={2}
                    radius={index === series.length - 1 ? [4, 4, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            ) : (
              <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
                <CartesianGrid vertical={false} stroke={AXIS} strokeOpacity={0.2} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: AXIS }} interval="preserveStartEnd" />
                <YAxis width={48} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: AXIS }} tickFormatter={tick} allowDecimals={false} />
                {tooltip}
                {series.map((item) => (
                  <Line
                    key={item.key}
                    type="monotone"
                    dataKey={item.key}
                    stroke={item.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: item.color }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>

        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-medium text-wa-muted dark:text-wa-muted-dark">Participación del período</p>
          <div className="mx-auto h-40 max-w-[200px]" role="img" aria-label="Participación de cada tratamiento en el período">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pie} dataKey="value" nameKey="name" innerRadius={0} outerRadius="95%" stroke="var(--viz-surface)" strokeWidth={2} isAnimationActive={false}>
                  {pie.map((item) => <Cell key={item.key} fill={item.color} />)}
                </Pie>
                <ChartTooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM} formatter={(value, name, entry) => [`${format(Number(value))} · ${(entry.payload as { share: number }).share}%`, String(name)]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 space-y-1.5 text-xs">
            {pie.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: item.color }} aria-hidden="true" />
                  <span className="truncate text-gray-700 dark:text-gray-200">{item.name}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-medium text-gray-800 dark:text-wa-text-dark">{format(item.value)}</span>
                  <span className="ml-1.5 text-wa-muted dark:text-wa-muted-dark">{item.share}%</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {partial && (
        <p className="mt-2 text-[11px] text-wa-muted dark:text-wa-muted-dark">
          * La primera {unit} del período tiene solo {partial.partialDays} {partial.partialDays === 1 ? 'día' : 'días'}: su barra es más corta por eso.
        </p>
      )}

      <details className="mt-4 text-xs">
        <summary className="cursor-pointer text-wa-muted dark:text-wa-muted-dark">Ver como tabla</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full whitespace-nowrap text-right tabular-nums">
            <thead className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
              <tr>
                <th scope="col" className="py-1 pr-3 text-left font-medium">Tratamiento</th>
                {visibleBuckets.map((bucket) => (
                  <th key={bucket.start} scope="col" className="px-2 py-1 font-medium">{shortDay(bucket.start)}{bucket.partialDays ? '*' : ''}</th>
                ))}
                <th scope="col" className="py-1 pl-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="text-gray-700 dark:text-gray-300">
              {series.map((item) => (
                <tr key={item.key} className="border-t border-wa-border dark:border-wa-border-dark">
                  <th scope="row" className="py-1 pr-3 text-left font-normal">{item.name}</th>
                  {visibleBuckets.map((bucket) => <td key={bucket.start} className="px-2 py-1">{format(bucket.values[item.key] ?? 0)}</td>)}
                  <td className="py-1 pl-2 font-medium">{format(pie.find((share) => share.key === item.key)?.value ?? 0)}</td>
                </tr>
              ))}
              <tr className="border-t border-wa-border font-semibold dark:border-wa-border-dark">
                <th scope="row" className="py-1 pr-3 text-left">Total</th>
                {visibleBuckets.map((bucket) => <td key={bucket.start} className="px-2 py-1">{format(bucket.total)}</td>)}
                <td className="py-1 pl-2">{format(visibleBuckets.reduce((sum, bucket) => sum + bucket.total, 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
