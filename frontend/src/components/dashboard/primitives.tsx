import type { LucideIcon } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip } from 'recharts'
import type { DashboardFunnelStep, DashboardMetricItem, DashboardPoint, DashboardTagRow } from '../../types'
import { PLACEHOLDER_NAMES, formatDayLabel, formatNumber } from './format'

interface MetricCardProps {
  label: string
  value: string | number
  hint: string
  icon: LucideIcon
  danger?: boolean
  onClick?: () => void
}

export function MetricCard({ label, value, hint, icon: Icon, danger = false, onClick }: MetricCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-wa-muted dark:text-wa-muted-dark">{label}</p>
          <p className={`mt-1 text-2xl font-semibold ${danger ? 'text-red-600 dark:text-red-400' : 'text-wa-text dark:text-white'}`}>
            {typeof value === 'number' ? formatNumber(value) : value}
          </p>
        </div>
        <span className={`rounded-lg p-2 ${danger ? 'bg-red-50 text-red-600 dark:bg-red-950/50' : 'bg-green-50 text-wa-primary-strong dark:bg-green-950/50'}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-[11px] text-wa-muted">{hint}</p>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-xl border border-wa-border bg-white p-4 text-left shadow-sm transition-colors hover:border-wa-primary/40 hover:shadow-md dark:border-wa-border-dark dark:bg-wa-panel-dark dark:hover:border-green-800"
      >
        {content}
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-wa-border bg-white p-4 shadow-sm dark:border-wa-border-dark dark:bg-wa-panel-dark">
      {content}
    </div>
  )
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-wa-border bg-white p-5 shadow-sm dark:border-wa-border-dark dark:bg-wa-panel-dark ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-wa-text-dark">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[11px] text-wa-muted dark:text-wa-muted-dark">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function NoData({ label = 'Sin datos todavía' }: { label?: string }) {
  return <p className="py-4 text-center text-xs text-wa-muted">{label}</p>
}

interface BarListProps {
  items: DashboardMetricItem[]
  labels?: Record<string, string>
  onSelect?: (name: string) => void
  emptyLabel?: string
}

export function BarList({ items, labels, onSelect, emptyLabel }: BarListProps) {
  if (items.length === 0) return <NoData label={emptyLabel} />

  const max = Math.max(...items.map((item) => item.value), 1)

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const label = labels?.[item.name] ?? item.name
        const selectable = !!onSelect && !PLACEHOLDER_NAMES.has(item.name)
        const bar = (
          <div className="h-2 overflow-hidden rounded-full bg-wa-field dark:bg-wa-head-dark">
            <div className="h-full rounded-full bg-wa-primary" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        )
        const header = (
          <div className="mb-1 flex justify-between gap-3 text-xs">
            <span className="truncate text-gray-600 dark:text-gray-300">{label}</span>
            <span className="font-medium text-gray-800 dark:text-wa-text-dark">{formatNumber(item.value)}</span>
          </div>
        )

        if (selectable) {
          return (
            <button
              key={item.name}
              type="button"
              onClick={() => onSelect(item.name)}
              className="block w-full rounded-md text-left transition-opacity hover:opacity-80"
            >
              {header}
              {bar}
            </button>
          )
        }

        return (
          <div key={item.name}>
            {header}
            {bar}
          </div>
        )
      })}
    </div>
  )
}

/** Barras con el color propio de cada etiqueta del catálogo, para que el panel
 *  se lea igual que las píldoras del chat. */
export function TagBarList({ items, onSelect }: { items: DashboardTagRow[]; onSelect?: (tagId: number) => void }) {
  if (items.length === 0) return <NoData label="Ninguna etiqueta en uso" />

  const max = Math.max(...items.map((item) => item.value), 1)

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const body = (
          <>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
                <span className="truncate text-gray-600 dark:text-gray-300">{item.name}</span>
              </span>
              <span className="font-medium text-gray-800 dark:text-wa-text-dark">{formatNumber(item.value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-wa-field dark:bg-wa-head-dark">
              <div
                className="h-full rounded-full"
                style={{ width: `${(item.value / max) * 100}%`, backgroundColor: item.color }}
              />
            </div>
          </>
        )

        if (onSelect) {
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className="block w-full rounded-md text-left transition-opacity hover:opacity-80"
            >
              {body}
            </button>
          )
        }
        return <div key={item.id}>{body}</div>
      })}
    </div>
  )
}

export interface StackSegment {
  key: string
  label: string
  /** Clases Tailwind de fondo, con su paso de modo oscuro. */
  color: string
}

/** Barra apilada por fila: cada segmento lleva su cifra en la leyenda y un
 *  hueco de 2px contra el siguiente, porque el color solo no alcanza para
 *  distinguirlos (ver los tokens --color-viz-* en index.css). */
export function StackedBarList({
  rows,
  segments,
  onSelect,
}: {
  rows: { key: string; label: string; sublabel?: string; total: number; parts: Record<string, number> }[]
  segments: StackSegment[]
  onSelect?: (key: string) => void
}) {
  if (rows.length === 0) return <NoData label="Ningún flujo se activó en el período" />

  const max = Math.max(...rows.map((row) => row.total), 1)

  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5 text-[11px] text-wa-muted dark:text-wa-muted-dark">
            <span className={`h-2 w-2 rounded-sm ${segment.color}`} aria-hidden="true" />
            {segment.label}
          </li>
        ))}
      </ul>

      <div className="space-y-3">
        {rows.map((row) => {
          const content = (
            <>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-gray-600 dark:text-gray-300">{row.label}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  {segments.map((segment) =>
                    row.parts[segment.key] ? (
                      <span key={segment.key} className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
                        <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-sm ${segment.color}`} aria-hidden="true" />
                        {formatNumber(row.parts[segment.key])}
                      </span>
                    ) : null,
                  )}
                  <span className="font-medium text-gray-800 dark:text-wa-text-dark">{formatNumber(row.total)}</span>
                </span>
              </div>
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-wa-field dark:bg-wa-head-dark" style={{ width: `${(row.total / max) * 100}%` }}>
                {segments.map((segment) => {
                  const value = row.parts[segment.key] ?? 0
                  if (!value) return null
                  return (
                    <span
                      key={segment.key}
                      className={`h-full first:rounded-l-full last:rounded-r-full ${segment.color}`}
                      style={{ width: `${(value / row.total) * 100}%` }}
                    />
                  )
                })}
              </div>
              {row.sublabel && <p className="mt-1 text-[10px] text-wa-muted">{row.sublabel}</p>}
            </>
          )

          if (onSelect) {
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => onSelect(row.key)}
                className="block w-full rounded-md text-left transition-opacity hover:opacity-80"
              >
                {content}
              </button>
            )
          }
          return <div key={row.key}>{content}</div>
        })}
      </div>
    </div>
  )
}

/** Embudo: el ancho es proporcional al primer paso y el porcentaje va siempre
 *  contra la cohorte del período, no contra el paso anterior — así "Cliente 12%"
 *  se lee directo sin multiplicar tasas. */
export function FunnelList({ steps }: { steps: DashboardFunnelStep[] }) {
  const base = steps[0]?.value ?? 0
  if (base === 0) return <NoData label="Sin leads nuevos en el período" />

  return (
    <div className="space-y-2.5">
      {steps.map((step) => {
        const isLost = step.name === 'Perdido'
        const width = Math.max((step.value / base) * 100, step.value > 0 ? 3 : 0)
        return (
          <div key={step.name}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate text-gray-600 dark:text-gray-300">{step.name}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="font-medium text-gray-800 dark:text-wa-text-dark">{formatNumber(step.value)}</span>
                {step.rate != null && (
                  <span className="text-[11px] text-wa-muted dark:text-wa-muted-dark">{step.rate}%</span>
                )}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-wa-field dark:bg-wa-head-dark">
              <div
                className={`h-full rounded-full ${isLost ? 'bg-viz-failed dark:bg-viz-failed-dark' : 'bg-viz-done dark:bg-viz-done-dark'}`}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Cifras sin gráfico: cuando el dato es un número y no una comparación, una
 *  barra de un solo valor solo agrega ruido. */
export function StatGrid({ stats }: { stats: { label: string; value: string; hint?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-lg bg-wa-app p-3 dark:bg-wa-head-dark">
          <dt className="text-[11px] text-wa-muted dark:text-wa-muted-dark">{stat.label}</dt>
          <dd className="mt-0.5 text-lg font-semibold text-wa-text dark:text-white">{stat.value}</dd>
          {stat.hint && <p className="text-[10px] text-wa-muted">{stat.hint}</p>}
        </div>
      ))}
    </dl>
  )
}

export function TrendChart({ points, label }: { points: DashboardPoint[]; label: string }) {
  const gradientId = `dashboardArea-${label.replace(/\s+/g, '-')}`
  return (
    <div>
      <div className="h-48 w-full" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 8 }} accessibilityLayer>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#00a884" stopOpacity={0.28} />
                <stop offset="1" stopColor="#00a884" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
            <ChartTooltip
              cursor={{ stroke: '#8696a0', strokeDasharray: '3 3' }}
              labelFormatter={date => formatDayLabel(String(date))}
              formatter={value => [formatNumber(Number(value)), label]}
              contentStyle={{ borderRadius: 10, borderColor: '#e9edef', boxShadow: '0 8px 24px rgb(0 0 0 / 0.12)', fontSize: 12 }}
            />
            <Area type="monotone" dataKey="value" stroke="#008069" strokeWidth={2} fill={`url(#${gradientId})`} activeDot={{ r: 4, fill: '#008069' }} />
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
