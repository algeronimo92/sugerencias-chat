import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis,
} from 'recharts'
import type { DashboardMessagesByOrigin } from '../types'
import { formatDayLabel, formatNumber } from './format'
import { NoData } from './primitives'
import { isSunday } from './salesFormat'
import { MESSAGE_ORIGINS, groupByOrigin, originShares } from './messageOrigins'

const AXIS = '#8696a0'
const TOOLTIP_STYLE = {
  borderRadius: 10,
  borderColor: 'var(--viz-border)',
  background: 'var(--viz-surface)',
  color: 'var(--viz-text)',
  boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)',
  fontSize: 12,
}
const TOOLTIP_ITEM = { color: 'var(--viz-text)', padding: '1px 0' }
const TOOLTIP_LABEL = { color: 'var(--viz-muted)', marginBottom: 4 }

function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })
}

/** Todo lo que mandó el negocio, por día y por de dónde salió: la app, los
 *  flujos, los programados o el celular (fuera de la app). Las barras dicen
 *  cuánto y cuándo; la torta, qué parte del período fue cada origen. */
export function MessagesByOriginPanel({ points, days }: { points: DashboardMessagesByOrigin[]; days: number }) {
  const buckets = groupByOrigin(points, days >= 90 ? 7 : 1)
  const pie = originShares(points)
  const total = pie.reduce((sum, item) => sum + item.value, 0)
  if (total === 0) return <NoData label="El negocio no envió mensajes en el período" />

  const weekly = days >= 90
  const sundays = weekly ? [] : buckets.filter((bucket) => isSunday(bucket.date)).map((bucket) => bucket.date)
  const phone = pie.find((item) => item.key === 'phone')
  const label = (bucket: (typeof buckets)[number]) =>
    bucket.end !== bucket.date ? `${shortDay(bucket.date)} – ${shortDay(bucket.end)}` : formatDayLabel(bucket.date)

  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-wa-text dark:text-wa-text-dark">
        {formatNumber(total)} mensajes del negocio
        {phone && phone.value > 0 ? `: el ${phone.share}% salió desde el celular, fuera de la app.` : '.'}
      </p>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {/* La leyenda va pegada a las barras: la de la torta queda debajo en
              el celular y lejos del gráfico en pantallas anchas. */}
          <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-wa-muted dark:text-wa-muted-dark" aria-label="Colores de cada origen">
            {MESSAGE_ORIGINS.map((origin) => (
              <li key={origin.key} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: origin.color }} aria-hidden="true" />
                {origin.label}
              </li>
            ))}
            {sundays.length > 0 && (
              <li className="flex items-center gap-1.5">
                <span className="h-3 border-l border-dashed border-viz-idle" aria-hidden="true" />
                Domingo (cierre de semana)
              </li>
            )}
          </ul>
          <div className="h-56 w-full" role="img" aria-label={`Mensajes del negocio por ${weekly ? 'semana' : 'día'} y por origen`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets} margin={{ top: sundays.length ? 18 : 8, right: 4, bottom: 0, left: 0 }} accessibilityLayer>
                <CartesianGrid vertical={false} stroke={AXIS} strokeOpacity={0.2} />
                <XAxis dataKey="date" tickFormatter={shortDay} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: AXIS }} interval="preserveStartEnd" />
                <YAxis width={40} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: AXIS }} allowDecimals={false} />
                {sundays.map((date) => (
                  <ReferenceLine key={date} x={date} stroke={AXIS} strokeOpacity={0.55} strokeDasharray="3 4"
                    label={{ value: `dom ${Number(date.slice(8, 10))}`, position: 'top', fontSize: 10, fill: AXIS }} />
                ))}
                <ChartTooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={TOOLTIP_ITEM}
                  labelStyle={TOOLTIP_LABEL}
                  cursor={{ fill: AXIS, fillOpacity: 0.08 }}
                  labelFormatter={(_, payload) => {
                    const bucket = payload?.[0]?.payload as (typeof buckets)[number] | undefined
                    return bucket ? `${label(bucket)} · total ${formatNumber(bucket.total)}` : ''
                  }}
                  formatter={(value, name) => [formatNumber(Number(value)), MESSAGE_ORIGINS.find((origin) => origin.key === name)?.label ?? String(name)]}
                />
                {MESSAGE_ORIGINS.map((origin) => (
                  <Bar key={origin.key} dataKey={origin.key} stackId="origen" fill={origin.color} maxBarSize={36}
                    // 2px de la superficie entre segmentos: el color solo no separa dos orígenes vecinos.
                    stroke="var(--viz-surface)" strokeWidth={2} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <div className="mx-auto h-40 w-40" role="img" aria-label="Qué parte de los mensajes salió de cada origen">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pie} dataKey="value" nameKey="label" innerRadius={0} outerRadius="95%" stroke="var(--viz-surface)" strokeWidth={2} isAnimationActive={false}>
                  {pie.map((item) => <Cell key={item.key} fill={item.color} />)}
                </Pie>
                <ChartTooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM}
                  formatter={(value, name, entry) => [`${formatNumber(Number(value))} · ${(entry.payload as { share: number }).share}%`, String(name)]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 space-y-1.5 text-xs" aria-label="Mensajes por origen">
            {pie.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: item.color }} aria-hidden="true" />
                  <span className="truncate text-gray-700 dark:text-gray-200">{item.label}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-medium text-gray-800 dark:text-wa-text-dark">{formatNumber(item.value)}</span>
                  <span className="ml-1.5 text-wa-muted dark:text-wa-muted-dark">{item.share}%</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-wa-muted dark:text-wa-muted-dark">Ver como tabla</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left">
            <thead className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
              <tr>
                <th scope="col" className="py-1 font-medium">{weekly ? 'Semana' : 'Día'}</th>
                {MESSAGE_ORIGINS.map((origin) => <th key={origin.key} scope="col" className="py-1 text-right font-medium">{origin.short}</th>)}
              </tr>
            </thead>
            <tbody className="tabular-nums text-gray-700 dark:text-gray-300">
              {buckets.map((bucket) => (
                <tr key={bucket.date} className="border-t border-wa-border dark:border-wa-border-dark">
                  <td className="py-1">{label(bucket)}</td>
                  {MESSAGE_ORIGINS.map((origin) => <td key={origin.key} className="py-1 text-right">{formatNumber(bucket[origin.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
