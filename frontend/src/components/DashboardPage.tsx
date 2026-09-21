import { useState, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  CalendarRange,
  CheckCircle2,
  Clock3,
  LayoutDashboard,
  Loader2,
  MessageCircleReply,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChatFilters, DashboardMetricItem, DashboardPoint } from '../types'
import { isLeadStage } from '../types'
import { useDashboard } from '../hooks/useDashboard'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'
import { Select } from './ui/Input'

const STAGE_LABELS: Record<string, string> = {
  nuevo: 'Nuevo',
  en_diagnostico: 'En diagnóstico',
  calificado: 'Calificado',
  oferta_presentada: 'Oferta presentada',
  en_objecion: 'En objeción',
  agendado: 'Agendado',
  cliente_activo: 'Cliente activo',
  postventa: 'Postventa',
  en_seguimiento: 'En seguimiento',
  en_nutricion: 'En nutrición',
  perdido: 'Perdido',
  descalificado: 'Descalificado',
  baja: 'Baja',
}

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
  icon: LucideIcon
  danger?: boolean
  onClick?: () => void
}

function MetricCard({ label, value, hint, icon: Icon, danger = false, onClick }: MetricCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark">{label}</p>
          <p className={`mt-2 text-3xl font-bold tracking-tight ${danger ? 'text-rose-600 dark:text-rose-400' : 'text-wa-text dark:text-white'}`}>{value}</p>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${danger ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300' : 'bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary'}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <p className="text-[11px] leading-4 text-wa-muted dark:text-wa-muted-dark">{hint}</p>
        {onClick && <ArrowUpRight className="h-4 w-4 shrink-0 text-wa-primary-strong opacity-60 transition group-hover:opacity-100 dark:text-wa-primary" />}
      </div>
    </>
  )

  const classes = 'group flex min-h-36 flex-col rounded-2xl border border-wa-border bg-white/90 p-5 text-left shadow-sm transition dark:border-wa-border-dark dark:bg-wa-panel-dark/90'

  if (onClick) {
    return <button type="button" onClick={onClick} className={`${classes} hover:-translate-y-0.5 hover:border-wa-primary/40 hover:shadow-md`}>{content}</button>
  }

  return <div className={classes}>{content}</div>
}

interface BarListProps {
  items: DashboardMetricItem[]
  labels?: Record<string, string>
  onSelect?: (name: string) => void
  accent?: 'brand' | 'cyan' | 'violet'
}

function BarList({ items, labels, onSelect, accent = 'brand' }: BarListProps) {
  if (items.length === 0) {
    return <p className="rounded-xl border border-dashed border-wa-border px-4 py-8 text-center text-xs text-wa-muted dark:border-wa-border-dark">Sin datos todavía</p>
  }

  const max = Math.max(...items.map(item => item.value), 1)
  const barColor = accent === 'cyan' ? 'bg-cyan-500' : accent === 'violet' ? 'bg-violet-500' : 'bg-wa-primary'

  return (
    <div className="space-y-3.5">
      {items.map(item => {
        const label = labels?.[item.name] ?? item.name
        const selectable = !!onSelect && !PLACEHOLDER_NAMES.has(item.name)
        const row = (
          <>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
              <span className="truncate font-medium text-gray-600 dark:text-gray-300">{label}</span>
              <span className="rounded-md bg-wa-field px-1.5 py-0.5 font-bold tabular-nums text-wa-text dark:bg-wa-head-dark dark:text-white">{item.value}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-wa-field dark:bg-wa-head-dark">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${(item.value / max) * 100}%` }} />
            </div>
          </>
        )

        if (selectable) {
          return <button key={item.name} type="button" onClick={() => onSelect(item.name)} className="block w-full rounded-lg text-left transition hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary">{row}</button>
        }
        return <div key={item.name}>{row}</div>
      })}
    </div>
  )
}

function TrendChart({ points }: { points: DashboardPoint[] }) {
  const shortDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })

  return (
    <div className="h-72 w-full" role="img" aria-label="Leads nuevos por día">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 12, right: 8, bottom: 0, left: -12 }} accessibilityLayer>
          <defs>
            <linearGradient id="dashboardArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#00a884" stopOpacity={0.32} />
              <stop offset="1" stopColor="#00a884" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
          <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={38} axisLine={false} tickLine={false} tick={{ fill: '#8696a0', fontSize: 10 }} dy={8} />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={30} tick={{ fill: '#8696a0', fontSize: 10 }} />
          <ChartTooltip
            cursor={{ stroke: '#8696a0', strokeDasharray: '3 3' }}
            labelFormatter={date => new Date(`${String(date)}T00:00:00`).toLocaleDateString('es-PE')}
            formatter={value => [Number(value).toLocaleString('es-PE'), 'Leads']}
            contentStyle={{ borderRadius: 12, borderColor: '#d8e2df', boxShadow: '0 10px 30px rgb(0 0 0 / 0.14)', fontSize: 12 }}
          />
          <Area type="monotone" dataKey="value" stroke="#00a884" strokeWidth={3} fill="url(#dashboardArea)" activeDot={{ r: 5, fill: '#00a884', stroke: '#081216', strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

interface PanelProps {
  title: string
  description: string
  icon: LucideIcon
  children: ReactNode
  className?: string
  badge?: ReactNode
}

function Panel({ title, description, icon: Icon, children, className = '', badge }: PanelProps) {
  return (
    <section className={`rounded-2xl border border-wa-border bg-white/90 p-5 shadow-sm dark:border-wa-border-dark dark:bg-wa-panel-dark/90 sm:p-6 ${className}`}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary"><Icon className="h-4 w-4" /></span>
          <div>
            <h2 className="text-sm font-bold text-wa-text dark:text-white">{title}</h2>
            <p className="mt-1 text-[11px] leading-4 text-wa-muted dark:text-wa-muted-dark">{description}</p>
          </div>
        </div>
        {badge}
      </div>
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
    <div className="relative h-full overflow-x-hidden overflow-y-auto bg-wa-app dark:bg-wa-app-dark">
      <main className="relative mx-auto max-w-[1240px] px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
        <header className="flex flex-col gap-5" style={{ marginBottom: 28 }}>
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-wa-primary-strong dark:text-wa-primary">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-wa-primary/12"><LayoutDashboard className="h-4 w-4" /></span>
              Vista general
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-wa-text dark:text-white">Dashboard CRM</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">Supervisa la atención, el seguimiento y la distribución de tus leads desde un solo lugar.</p>
          </div>

          <div className="flex w-fit max-w-full flex-wrap items-center gap-2 self-start rounded-2xl border border-wa-border bg-white/85 p-2 shadow-sm backdrop-blur dark:border-wa-border-dark dark:bg-wa-panel-dark/85">
            {data && <span className="px-2 text-[11px] text-wa-muted dark:text-wa-muted-dark" title={new Date(data.generated_at).toLocaleString('es-PE')}>Actualizado {formatRelativeTime(data.generated_at)}</span>}
            <Button variant="secondary" size="icon" onClick={() => refetch()} disabled={isFetching} aria-label="Actualizar métricas" title="Actualizar métricas" className="h-10 w-10 rounded-xl">
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
            <label className="relative">
              <CalendarRange className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted" />
              <Select value={days} onChange={event => setDays(Number(event.target.value))} aria-label="Período del dashboard" className="h-10 rounded-xl border border-wa-border bg-[#f7faf9] py-2 pl-9 pr-9 text-sm font-semibold text-wa-text dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark">
                <option value={7}>Últimos 7 días</option>
                <option value={30}>Últimos 30 días</option>
                <option value={90}>Últimos 90 días</option>
              </Select>
            </label>
          </div>
        </header>

        {isLoading && <div className="flex min-h-96 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-wa-primary-strong dark:text-wa-primary" /></div>}

        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            <AlertCircle className="h-5 w-5 shrink-0" />{extractErrorMessage(error)}
          </div>
        )}

        {data && (
          <div className="space-y-6">
            <section
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}
              aria-label="Indicadores principales"
            >
              <MetricCard label="Leads totales" value={data.summary.total_leads} hint="Base actual de contactos" icon={Users} />
              <MetricCard label="Leads nuevos" value={data.summary.new_leads} hint={`Captados en los últimos ${days} días`} icon={TrendingUp} />
              <MetricCard label="Esperando respuesta" value={data.summary.awaiting_reply} hint="El último mensaje fue del cliente" icon={MessageCircleReply} danger={data.summary.awaiting_reply > 0} onClick={() => onFilterChats({ lastSender: 'cliente' })} />
              <MetricCard label="Tareas vencidas" value={data.summary.overdue_tasks} hint="Pendientes fuera de plazo" icon={AlertCircle} danger={data.summary.overdue_tasks > 0} onClick={onOpenTasks} />
              <MetricCard label="Tareas completadas" value={data.summary.completed_tasks} hint={`Finalizadas en los últimos ${days} días`} icon={CheckCircle2} onClick={onOpenTasks} />
              <MetricCard label="Respuesta promedio" value={formatDuration(data.summary.avg_response_minutes)} hint="Tiempo medio de respuesta al cliente" icon={Clock3} />
            </section>

            <Panel
              title="Evolución de leads"
              description={`Nuevos contactos captados durante los últimos ${days} días.`}
              icon={TrendingUp}
              badge={<span className="rounded-full bg-wa-primary/10 px-3 py-1 text-xs font-bold text-wa-primary-strong dark:text-wa-primary">{data.summary.new_leads} nuevos</span>}
            >
              <TrendChart points={data.new_leads_trend} />
            </Panel>

            <div className="grid items-start gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 430px), 1fr))' }}>
              <div className="space-y-5">
                <Panel title="Leads por etapa" description="Distribución actual dentro del proceso comercial." icon={BarChart3}>
                  <BarList items={data.stages} labels={STAGE_LABELS} onSelect={stage => { if (isLeadStage(stage)) onFilterChats({ stages: [stage] }) }} />
                </Panel>
              </div>
              <div className="space-y-5">
                <Panel title="Carga por vendedor" description="Cantidad de leads asignados a cada integrante." icon={Users}>
                  <BarList items={data.sellers} accent="violet" />
                </Panel>
                <Panel title="Principales orígenes" description="Canales que están generando nuevos contactos." icon={Sparkles}>
                  <BarList items={data.origins} onSelect={origin => onFilterChats({ origin })} accent="cyan" />
                </Panel>
                <Panel title="Servicios de interés" description="Tratamientos o servicios más consultados." icon={Sparkles}>
                  <BarList items={data.services} onSelect={service => onFilterChats({ service })} />
                </Panel>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
