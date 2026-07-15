import { AlertCircle, CheckCircle2, Clock3, Loader2, MessageCircleReply, RefreshCw, TrendingUp, Users } from 'lucide-react'
import { useState } from 'react'
import type { ChatFilters, DashboardMetricItem, DashboardPoint, LeadStage } from '../types'
import { useDashboard } from '../hooks/useDashboard'
import { extractErrorMessage } from '../utils/errors'

const STAGE_LABELS: Record<string, string> = {
  nuevo: 'Nuevo',
  calificacion: 'Calificación',
  cotizacion: 'Cotización',
  objecion: 'Objeción',
  cierre: 'Cierre',
  agendado: 'Agendado',
  postventa: 'Postventa',
  sin_respuesta: 'Sin respuesta',
  reactivacion: 'Reactivación',
  perdido: 'Perdido',
}

// Estos son los buckets "sin dato" que arma el backend (COALESCE) para que
// las barras nunca queden vacías; no son valores reales de lead, así que no
// tiene sentido ofrecerlos como filtro.
const PLACEHOLDER_NAMES = new Set(['Sin origen', 'Sin servicio', 'Sin asignar'])

function formatDuration(minutes: number | null): string {
  if (minutes == null) return 'Sin datos'
  if (minutes < 60) return `${minutes.toLocaleString('es-PE')} min`
  return `${(minutes / 60).toLocaleString('es-PE', { maximumFractionDigits: 1 })} h`
}

function formatRelativeTime(iso: string): string {
  const diffMinutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (diffMinutes < 1) return 'hace un momento'
  if (diffMinutes < 60) return `hace ${diffMinutes} min`
  return `hace ${Math.round(diffMinutes / 60)} h`
}

interface MetricCardProps {
  label: string
  value: string | number
  hint: string
  icon: typeof Users
  danger?: boolean
  onClick?: () => void
}

function MetricCard({ label, value, hint, icon: Icon, danger = false, onClick }: MetricCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
          <p className={`mt-1 text-2xl font-semibold ${danger ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
            {value}
          </p>
        </div>
        <span className={`rounded-lg p-2 ${danger ? 'bg-red-50 text-red-600 dark:bg-red-950/50' : 'bg-green-50 text-green-600 dark:bg-green-950/50'}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-[11px] text-gray-400">{hint}</p>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-green-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-green-800"
      >
        {content}
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      {content}
    </div>
  )
}

interface BarListProps {
  items: DashboardMetricItem[]
  labels?: Record<string, string>
  onSelect?: (name: string) => void
}

function BarList({ items, labels, onSelect }: BarListProps) {
  if (items.length === 0) {
    return <p className="py-4 text-center text-xs text-gray-400">Sin datos todavía</p>
  }

  const max = Math.max(...items.map((item) => item.value), 1)

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const label = labels?.[item.name] ?? item.name
        const selectable = !!onSelect && !PLACEHOLDER_NAMES.has(item.name)
        const bar = (
          <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            <div className="h-full rounded-full bg-green-500" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        )
        const header = (
          <div className="mb-1 flex justify-between gap-3 text-xs">
            <span className="truncate text-gray-600 dark:text-gray-300">{label}</span>
            <span className="font-medium text-gray-800 dark:text-gray-100">{item.value}</span>
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

function TrendChart({ points }: { points: DashboardPoint[] }) {
  const width = 800
  const height = 180
  const padding = 12
  const max = Math.max(...points.map((point) => point.value), 1)
  const coordinates = points.map((point, index) => ({
    ...point,
    x: padding + (points.length <= 1 ? 0 : (index * (width - padding * 2)) / (points.length - 1)),
    y: height - padding - (point.value / max) * (height - padding * 2),
  }))
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(' ')
  const area = coordinates.length ? `${padding},${height - padding} ${line} ${coordinates.at(-1)?.x},${height - padding}` : ''

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full" role="img" aria-label="Leads nuevos por día">
        <defs>
          <linearGradient id="dashboardArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#22c55e" stopOpacity=".28" />
            <stop offset="1" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((value) => (
          <line
            key={value}
            x1={padding}
            x2={width - padding}
            y1={padding + (height - padding * 2) * value}
            y2={padding + (height - padding * 2) * value}
            stroke="currentColor"
            className="text-gray-100 dark:text-gray-800"
          />
        ))}
        {area && <polygon points={area} fill="url(#dashboardArea)" />}
        <polyline points={line} fill="none" stroke="#16a34a" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {coordinates
          .filter((_, index) => points.length <= 14 || index % Math.ceil(points.length / 14) === 0)
          .map((point) => (
            <circle key={point.date} cx={point.x} cy={point.y} r="3" fill="#16a34a">
              <title>
                {new Date(`${point.date}T00:00:00`).toLocaleDateString('es-PE')}: {point.value}
              </title>
            </circle>
          ))}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>{points[0] ? new Date(`${points[0].date}T00:00:00`).toLocaleDateString('es-PE') : ''}</span>
        <span>{points.at(-1) ? new Date(`${points.at(-1)?.date}T00:00:00`).toLocaleDateString('es-PE') : ''}</span>
      </div>
    </div>
  )
}

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 ${className}`}>
      <h2 className="mb-4 text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h2>
      {children}
    </section>
  )
}

interface Props {
  onOpenTasks: () => void
  onFilterChats: (filters: Partial<ChatFilters>) => void
}

export function DashboardPage({ onOpenTasks, onFilterChats }: Props) {
  const [days, setDays] = useState(30)
  const { data, isLoading, isFetching, error, refetch } = useDashboard(days)

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6 dark:bg-gray-950">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Dashboard CRM</h1>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Atención, seguimiento y distribución de leads</p>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <span className="text-[11px] text-gray-400" title={new Date(data.generated_at).toLocaleString('es-PE')}>
                Actualizado {formatRelativeTime(data.generated_at)}
              </span>
            )}
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-gray-500 hover:text-green-600 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            </button>
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              <option value={7}>Últimos 7 días</option>
              <option value={30}>Últimos 30 días</option>
              <option value={90}>Últimos 90 días</option>
            </select>
          </div>
        </div>

        {isLoading && (
          <div className="flex justify-center py-24">
            <Loader2 className="h-7 w-7 animate-spin text-green-600" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            <AlertCircle className="h-4 w-4" /> {extractErrorMessage(error)}
          </div>
        )}

        {data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <MetricCard label="Leads totales" value={data.summary.total_leads} hint="Base actual" icon={Users} />
              <MetricCard
                label="Leads nuevos"
                value={data.summary.new_leads}
                hint={`Últimos ${days} días`}
                icon={TrendingUp}
              />
              <MetricCard
                label="Esperando respuesta"
                value={data.summary.awaiting_reply}
                hint="Último mensaje del cliente"
                icon={MessageCircleReply}
                danger={data.summary.awaiting_reply > 0}
                onClick={() => onFilterChats({ lastSender: 'cliente' })}
              />
              <MetricCard
                label="Tareas vencidas"
                value={data.summary.overdue_tasks}
                hint="Pendientes fuera de plazo"
                icon={AlertCircle}
                danger={data.summary.overdue_tasks > 0}
                onClick={onOpenTasks}
              />
              <MetricCard
                label="Tareas completadas"
                value={data.summary.completed_tasks}
                hint={`Últimos ${days} días`}
                icon={CheckCircle2}
                onClick={onOpenTasks}
              />
              <MetricCard
                label="Respuesta promedio"
                value={formatDuration(data.summary.avg_response_minutes)}
                hint="A mensajes del cliente"
                icon={Clock3}
              />
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <Panel title="Leads nuevos por día" className="lg:col-span-2">
                <TrendChart points={data.new_leads_trend} />
              </Panel>
              <Panel title="Leads por etapa">
                <BarList
                  items={data.stages}
                  labels={STAGE_LABELS}
                  onSelect={(stage) => onFilterChats({ stages: [stage as LeadStage] })}
                />
              </Panel>
              <Panel title="Carga por vendedor">
                <BarList items={data.sellers} />
              </Panel>
              <Panel title="Principales orígenes">
                <BarList items={data.origins} onSelect={(origin) => onFilterChats({ origin })} />
              </Panel>
              <Panel title="Servicios de interés">
                <BarList items={data.services} onSelect={(service) => onFilterChats({ service })} />
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
