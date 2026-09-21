import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, Ban, CheckCircle2, ChevronDown, Clock3, Layers, Loader2, MessageSquare,
  PauseCircle, PlayCircle, RefreshCw, RotateCcw, Send, SkipForward, XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useAutomationExecutions, useCancelExecution, useManualFlows } from '../hooks/useAutomations'
import {
  ACTIVE_EXECUTION_STATUSES, AutomationExecutionStatus, AutomationTrigger, automationStepLabel,
  isServiceWindowError, type AutomationExecutionStatusValue,
} from '../domain/automationCatalog'
import type { AutomationActionResult, AutomationExecution } from '../types'
import {
  executionStatusLabel, executionTriggerLabel, formatExecutionDate, isoDateOffset, todayISODate,
} from '../utils/automationExecutions'
import { cn } from '../utils/cn'
import { extractErrorMessage } from '../utils/errors'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Select, fieldClass } from './ui/Input'
import { Skeleton } from './ui/Skeleton'
import { StatChip } from './ui/StatChip'
import { STAT_TONE_ICON as TONE_ICON, type StatTone } from './ui/tones'

/* ---------------------------------------------------------------------------
 * Vocabulario de la pantalla
 *
 * El historial se pide una sola vez por período y flujo, y el filtro por
 * estado se resuelve en memoria. Dos razones: los contadores de cada grupo
 * tienen que contar sobre el total del período (si el backend ya filtrara por
 * estado, cada número se contaría a sí mismo), y cambiar de grupo se siente
 * instantáneo en vez de costar un viaje de red.
 * ------------------------------------------------------------------------- */

type Tone = StatTone
type GroupKey = 'all' | 'active' | 'completed' | 'failed' | 'skipped'
type PeriodKey = 'today' | 'week' | 'month' | 'custom'

interface StatusGroup {
  key: GroupKey
  label: string
  /** Qué responde este grupo, en una línea, para el tooltip nativo. */
  hint: string
  /** Título del estado vacío cuando este grupo está seleccionado. */
  emptyTitle: string
  icon: LucideIcon
  tone: Tone
  matches: (status: AutomationExecutionStatusValue) => boolean
}

const STATUS_GROUPS: readonly StatusGroup[] = [
  {
    key: 'all', label: 'Todos', hint: 'Todo lo que enviaste en el período.',
    emptyTitle: 'Sin envíos en este período',
    icon: Layers, tone: 'neutral', matches: () => true,
  },
  {
    key: 'active', label: 'En curso', hint: 'Siguen corriendo sobre el lead.',
    emptyTitle: 'No tienes envíos en curso',
    icon: PlayCircle, tone: 'info',
    matches: status => ACTIVE_EXECUTION_STATUSES.includes(status),
  },
  {
    key: 'completed', label: 'Completados', hint: 'Terminaron todos sus pasos.',
    emptyTitle: 'Ningún envío completado en este período',
    icon: CheckCircle2, tone: 'success',
    matches: status => status === AutomationExecutionStatus.Completed,
  },
  {
    key: 'failed', label: 'Con error', hint: 'Se cortaron antes de terminar.',
    emptyTitle: 'Ningún envío con error: todo salió bien',
    icon: XCircle, tone: 'danger',
    matches: status => status === AutomationExecutionStatus.Failed,
  },
  {
    key: 'skipped', label: 'Omitidos', hint: 'El flujo no aplicaba a ese lead.',
    emptyTitle: 'Ningún envío omitido en este período',
    icon: SkipForward, tone: 'warning',
    matches: status => status === AutomationExecutionStatus.Skipped,
  },
]

const PERIODS: readonly { key: PeriodKey; label: string; offset: number | null }[] = [
  { key: 'today', label: 'Hoy', offset: 0 },
  { key: 'week', label: '7 días', offset: -6 },
  { key: 'month', label: '30 días', offset: -29 },
  { key: 'custom', label: 'Otro', offset: null },
]

const BADGE_VARIANT: Record<Tone, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  neutral: 'neutral', info: 'info', success: 'success', danger: 'danger', warning: 'warning',
}

function statusTone(status: AutomationExecutionStatusValue): Tone {
  if (status === AutomationExecutionStatus.Completed) return 'success'
  if (status === AutomationExecutionStatus.Failed) return 'danger'
  if (status === AutomationExecutionStatus.Skipped) return 'warning'
  if (status === AutomationExecutionStatus.Paused) return 'warning'
  return 'info'
}

function statusIcon(status: AutomationExecutionStatusValue): LucideIcon {
  if (status === AutomationExecutionStatus.Completed) return CheckCircle2
  if (status === AutomationExecutionStatus.Failed) return XCircle
  if (status === AutomationExecutionStatus.Skipped) return SkipForward
  if (status === AutomationExecutionStatus.Paused) return PauseCircle
  if (status === AutomationExecutionStatus.Running) return Loader2
  return Clock3
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
}

/** Clave local 'YYYY-MM-DD' de un instante ISO, para agrupar por día. */
function dayKey(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dayLabel(key: string) {
  if (key === todayISODate()) return 'Hoy'
  if (key === isoDateOffset(-1)) return 'Ayer'
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

function periodLabel(from: string, to: string) {
  if (from === to) return dayLabel(from)
  return `${dayLabel(from)} — ${dayLabel(to)}`
}

/** Qué le falta a una ejecución viva, en lenguaje del vendedor. */
function pendingLabel(execution: AutomationExecution) {
  if (execution.status === AutomationExecutionStatus.Running) return 'Ejecutándose ahora'
  if (execution.status === AutomationExecutionStatus.Paused) return 'En pausa'
  return `Próximo paso ${formatExecutionDate(execution.scheduled_for)}`
}

/** La segunda línea de la fila: en qué quedó el envío, sin tener que abrirlo.
 *  Es lo que convierte el ancho de escritorio en información en vez de hueco. */
function rowSummary(execution: AutomationExecution) {
  if (ACTIVE_EXECUTION_STATUSES.includes(execution.status)) return pendingLabel(execution)
  if (execution.status === AutomationExecutionStatus.Failed) {
    if (isServiceWindowError(execution.error)) return 'No salió: la ventana de 24 h estaba cerrada'
    return execution.error ?? 'El flujo se cortó antes de terminar'
  }
  if (execution.status === AutomationExecutionStatus.Skipped) return 'El flujo no aplicaba a este lead'
  const steps = execution.action_results?.length ?? 0
  const finished = execution.finished_at ? ` · terminó ${timeLabel(execution.finished_at)}` : ''
  return `${steps} ${steps === 1 ? 'paso' : 'pasos'}${finished}`
}

function stepDetail(step: AutomationActionResult) {
  if (step.branch) return `siguió por "${step.branch}"`
  if (step.error) return step.error
  if (step.seconds) return 'espera programada'
  if (step.conditions?.length) return 'espera un mensaje o el temporizador'
  return ''
}

function groupByDay(executions: AutomationExecution[]) {
  const groups: { key: string; items: AutomationExecution[] }[] = []
  for (const execution of executions) {
    const key = dayKey(execution.created_at)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(execution)
    else groups.push({ key, items: [execution] })
  }
  return groups
}

/* -------------------------------------------------------------------- fila */

function ExecutionRow({ execution, onCancel, isCancelling }: {
  execution: AutomationExecution
  onCancel: () => void
  isCancelling: boolean
}) {
  const navigate = useNavigate()
  const tone = statusTone(execution.status)
  const Icon = statusIcon(execution.status)
  const isActive = ACTIVE_EXECUTION_STATUSES.includes(execution.status)
  const failed = execution.status === AutomationExecutionStatus.Failed
  const leadLabel = execution.lead_name || execution.lead_id || 'Lead eliminado'
  const steps = execution.action_results ?? []
  const serviceWindow = isServiceWindowError(execution.error)
  const summary = rowSummary(execution)

  return (
    <details className="group border-b border-wa-border last:border-b-0 dark:border-wa-border-dark">
      <summary className="flex scroll-mt-4 cursor-pointer list-none items-center gap-3 px-3 py-3 outline-none transition-colors duration-150 hover:bg-wa-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wa-primary/70 dark:hover:bg-wa-head-dark sm:px-4 [&::-webkit-details-marker]:hidden">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-wa-field dark:bg-wa-field-dark ${TONE_ICON[tone]}`}>
          <Icon className={`h-4.5 w-4.5 ${execution.status === AutomationExecutionStatus.Running ? 'animate-spin' : ''}`} aria-hidden="true" />
        </span>

        <span className="min-w-0 flex-1 lg:flex-2">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-wa-text dark:text-white">{execution.rule_name}</span>
            {/* En móvil el ancho es para el nombre: la advertencia se explica
                mejor dentro del detalle que como pastilla que lo trunca. */}
            {execution.rule_deleted && (
              <Badge variant="warning" size="md" className="hidden shrink-0 text-xs sm:inline-flex">Flujo eliminado</Badge>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-wa-muted dark:text-wa-muted-dark lg:hidden">
            {leadLabel} · {timeLabel(execution.created_at)}
          </span>
          <span className={`mt-0.5 hidden truncate text-xs lg:block ${
            failed ? 'text-red-700 dark:text-red-300' : 'text-wa-muted dark:text-wa-muted-dark'
          }`}>
            {summary}
          </span>
          {failed && (
            <span className="mt-0.5 block truncate text-xs text-red-700 dark:text-red-300 lg:hidden">{summary}</span>
          )}
        </span>

        <span className="hidden min-w-0 flex-1 truncate text-sm text-wa-text dark:text-wa-text-dark lg:block">{leadLabel}</span>

        <span className="shrink-0 lg:w-28">
          <Badge variant={BADGE_VARIANT[tone]} size="md" className="text-xs">{executionStatusLabel(execution.status)}</Badge>
        </span>

        <span
          className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-wa-muted dark:text-wa-muted-dark lg:block"
          title={formatExecutionDate(execution.created_at)}
        >
          {timeLabel(execution.created_at)}
        </span>

        <ChevronDown className="h-4 w-4 shrink-0 text-wa-muted transition-transform duration-200 group-open:rotate-180 dark:text-wa-muted-dark" aria-hidden="true" />
        <span className="sr-only">Ver detalle del envío</span>
      </summary>

      <div className="border-t border-wa-border bg-wa-app px-3 py-4 dark:border-wa-border-dark dark:bg-wa-app-dark sm:px-4">
        <dl className="grid max-w-3xl gap-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-wa-muted dark:text-wa-muted-dark">Enviado</dt>
            <dd className="mt-1 font-medium text-wa-text dark:text-white">{formatExecutionDate(execution.created_at)}</dd>
          </div>
          <div>
            <dt className="text-wa-muted dark:text-wa-muted-dark">{isActive ? 'Próximo paso' : 'Finalizado'}</dt>
            <dd className="mt-1 font-medium text-wa-text dark:text-white">
              {isActive ? pendingLabel(execution) : formatExecutionDate(execution.finished_at)}
            </dd>
          </div>
          <div>
            <dt className="text-wa-muted dark:text-wa-muted-dark">Origen</dt>
            <dd className="mt-1 font-medium text-wa-text dark:text-white">
              {execution.trigger_type === AutomationTrigger.Manual && execution.start_source === 'manual'
                ? 'Lo iniciaste desde el chat'
                : execution.start_source === 'flow'
                  ? 'Llamado por otro flujo'
                  : executionTriggerLabel(execution.trigger_type)}
            </dd>
          </div>
        </dl>

        {execution.rule_deleted && (
          <p className="mt-3 text-xs text-amber-800 dark:text-amber-300">
            Este flujo se eliminó: el envío quedó registrado, pero ya no puedes volver a iniciarlo.
          </p>
        )}

        {steps.length > 0 && (
          <ol className="mt-4 space-y-1.5 border-l border-dashed border-wa-border pl-3 dark:border-wa-border-dark">
            {steps.map((step, index) => {
              const detail = stepDetail(step)
              const failed = step.status === AutomationExecutionStatus.Failed
              return (
                <li key={`${step.node_id ?? 'step'}-${index}`} className="flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${failed ? 'bg-red-500' : 'bg-wa-primary'}`} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="text-wa-text dark:text-wa-text-dark">
                      {step.position ?? index + 1}. {automationStepLabel(step.type)}
                    </span>
                    {detail && <span className="text-wa-muted dark:text-wa-muted-dark"> · {detail}</span>}
                  </span>
                </li>
              )
            })}
          </ol>
        )}

        {execution.error && (
          <div role="note" className="mt-4 flex max-w-3xl gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="block font-semibold">
                {serviceWindow ? 'No salió: la ventana de 24 h está cerrada' : 'El flujo se cortó'}
              </span>
              <span className="mt-0.5 block">
                {serviceWindow
                  ? 'WhatsApp solo deja escribir libre dentro de las 24 h desde el último mensaje del cliente. Mándale una plantilla para reabrir la conversación y vuelve a iniciar el flujo.'
                  : execution.error}
              </span>
            </span>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {execution.lead_id && (
            <Button
              variant="secondary"
              size="sm"
              className="h-9"
              onClick={() => navigate(`/chat/${encodeURIComponent(execution.lead_id!)}`)}
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              Abrir conversación
            </Button>
          )}
          {isActive && (
            <ConfirmDialog
              title="¿Cancelar este envío?"
              description={`"${execution.rule_name}" dejará de correr sobre ${leadLabel}. Los pasos que ya salieron no se deshacen y el flujo no se puede retomar donde estaba.`}
              confirmLabel="Cancelar envío"
              cancelLabel="Dejarlo correr"
              disabled={isCancelling}
              onConfirm={onCancel}
            >
              <Button variant="ghost" size="sm" className="h-9 text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-950/40 dark:hover:text-red-200" disabled={isCancelling}>
                {isCancelling
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Ban className="h-4 w-4" aria-hidden="true" />}
                Cancelar envío
              </Button>
            </ConfirmDialog>
          )}
        </div>
      </div>
    </details>
  )
}

/* ------------------------------------------------------------------ página */

/** Historial personal de flujos iniciados manualmente por el usuario. */
export function MyAutomationExecutionsPage() {
  const navigate = useNavigate()
  const { data: flows = [] } = useManualFlows()
  const cancelExecution = useCancelExecution()

  const [period, setPeriod] = useState<PeriodKey>('today')
  const [customFrom, setCustomFrom] = useState(todayISODate)
  const [customTo, setCustomTo] = useState(todayISODate)
  const [ruleId, setRuleId] = useState<number | null>(null)
  const [group, setGroup] = useState<GroupKey>('all')

  const preset = PERIODS.find(item => item.key === period)
  const dateFrom = period === 'custom' ? customFrom : isoDateOffset(preset?.offset ?? 0)
  const dateTo = period === 'custom' ? customTo : todayISODate()

  const { data: executions = [], isLoading, isFetching, isError, error, refetch } = useAutomationExecutions({
    mine: true,
    ruleId: ruleId ?? undefined,
    dateFrom,
    dateTo,
  })

  const counts = useMemo(() => {
    const result = {} as Record<GroupKey, number>
    for (const item of STATUS_GROUPS) {
      result[item.key] = executions.filter(execution => item.matches(execution.status)).length
    }
    return result
  }, [executions])

  const activeGroup = STATUS_GROUPS.find(item => item.key === group) ?? STATUS_GROUPS[0]
  const visible = useMemo(
    () => executions.filter(execution => activeGroup.matches(execution.status)),
    [executions, activeGroup],
  )
  const days = useMemo(() => groupByDay(visible), [visible])

  const isFiltered = period !== 'today' || ruleId !== null || group !== 'all'
  const flowName = flows.find(flow => flow.id === ruleId)?.name
  const periodSummary = period === 'custom'
    ? periodLabel(dateFrom, dateTo)
    : period === 'today' ? 'Hoy' : period === 'week' ? 'Últimos 7 días' : 'Últimos 30 días'

  function resetFilters() {
    setPeriod('today')
    setCustomFrom(todayISODate())
    setCustomTo(todayISODate())
    setRuleId(null)
    setGroup('all')
  }

  function selectPeriod(next: PeriodKey) {
    // 3.3.7 Redundant Entry: al pasar a "Otro" el rango arranca donde el
    // usuario ya estaba parado, no en blanco.
    if (next === 'custom') {
      setCustomFrom(dateFrom)
      setCustomTo(dateTo)
    }
    setPeriod(next)
  }

  function handleCancel(execution: AutomationExecution) {
    cancelExecution.mutate(execution.id, {
      onSuccess: () => toast.success(`"${execution.rule_name}" ya no se ejecutará`),
      onError: err => toast.error(extractErrorMessage(err)),
    })
  }

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto bg-wa-app dark:bg-wa-app-dark">
      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-wa-text dark:text-white">Flujos enviados</h1>
          <p className="mt-1.5 max-w-prose text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
            Revisa los flujos que iniciaste desde una conversación y en qué paso van.
          </p>
        </header>

        <section aria-label="Filtros del historial" className="mt-6 rounded-xl border border-wa-border bg-white p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="min-w-0">
              <p className="mb-2 text-sm font-semibold text-wa-text dark:text-wa-text-dark">Período</p>
              <div role="group" aria-label="Período del historial" className="inline-flex max-w-full rounded-lg border border-wa-border bg-wa-app p-1 dark:border-wa-border-dark dark:bg-wa-app-dark">
                {PERIODS.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => selectPeriod(item.key)}
                    aria-pressed={period === item.key}
                    className={`min-h-10 rounded-md px-3 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-wa-primary/60 ${
                      period === item.key
                        ? 'bg-white font-semibold text-wa-text shadow-sm dark:bg-wa-head-dark dark:text-wa-text-dark'
                        : 'text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-wa-head-dark dark:hover:text-wa-text-dark'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block min-w-0 flex-1 lg:max-w-xs">
              <span className="mb-2 block text-sm font-semibold text-wa-text dark:text-wa-text-dark">Flujo</span>
              <Select
                value={ruleId ?? ''}
                onChange={event => setRuleId(event.target.value ? Number(event.target.value) : null)}
                className="min-h-10 w-full border-wa-border bg-white shadow-none dark:border-wa-border-dark dark:bg-wa-panel-dark"
              >
                <option value="">Todos los flujos</option>
                {flows.map(flow => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
              </Select>
            </label>
          </div>

          {period === 'custom' && (
            <div className="mt-4 flex flex-col gap-3 border-t border-wa-border pt-4 sm:flex-row dark:border-wa-border-dark">
              <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark sm:max-w-48">
                Desde
                <input type="date" value={customFrom} max={customTo} onChange={event => setCustomFrom(event.target.value)} className={cn(fieldClass, 'min-h-10 w-full border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-panel-dark')} />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark sm:max-w-48">
                Hasta
                <input type="date" value={customTo} min={customFrom} max={todayISODate()} onChange={event => setCustomTo(event.target.value)} className={cn(fieldClass, 'min-h-10 w-full border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-panel-dark')} />
              </label>
            </div>
          )}
        </section>

        {executions.length > 0 && !isError && (
          <section aria-label="Filtrar por estado" className="mt-5 flex flex-wrap gap-2">
            {STATUS_GROUPS.map(item => (
              <StatChip
                key={item.key}
                icon={item.icon}
                label={item.label}
                hint={item.hint}
                tone={item.tone}
                count={counts[item.key] ?? 0}
                selected={group === item.key}
                onSelect={() => setGroup(item.key)}
                compact
              />
            ))}
          </section>
        )}

        <section className="mt-5" aria-busy={isFetching}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-wa-text dark:text-white">Historial</h2>
              <p aria-live="polite" className="mt-0.5 text-sm text-wa-muted dark:text-wa-muted-dark">
                {isLoading
                  ? 'Cargando envíos…'
                  : `${visible.length} ${visible.length === 1 ? 'envío' : 'envíos'} · ${periodSummary}${flowName ? ` · ${flowName}` : ''}`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {isFiltered && (
                <Button variant="ghost" size="sm" className="h-9" onClick={resetFilters}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Quitar filtros
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => { void refetch() }}
                aria-busy={isFetching}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
                {isFetching ? 'Actualizando…' : 'Actualizar'}
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-wa-border bg-white shadow-sm dark:border-wa-border-dark dark:bg-wa-panel-dark">
            {isLoading ? (
              <ul className="divide-y divide-wa-border dark:divide-wa-border-dark">
                {[0, 1, 2, 3, 4].map(index => (
                  <li key={index} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                    <Skeleton className="h-9 w-9 rounded-lg" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-48 max-w-full" />
                      <Skeleton className="h-3 w-32 max-w-full" />
                    </div>
                    <Skeleton className="hidden h-5 w-24 rounded-full sm:block" />
                  </li>
                ))}
              </ul>
            ) : isError ? (
              <div role="alert" className="flex flex-col items-start gap-3 px-5 py-8 sm:px-6">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-wa-text dark:text-white">No pudimos cargar tus envíos</p>
                  <p className="mt-1 max-w-lg text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
                    {extractErrorMessage(error)} Prueba de nuevo; si sigue igual, avisa al equipo.
                  </p>
                </div>
                <Button variant="secondary" size="sm" className="h-9" onClick={() => { void refetch() }}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reintentar
                </Button>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col gap-4 px-5 py-8 sm:flex-row sm:items-start sm:gap-5 sm:px-6">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-wa-field text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark">
                  {isFiltered ? <activeGroup.icon className="h-5 w-5" aria-hidden="true" /> : <Send className="h-5 w-5" aria-hidden="true" />}
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-wa-text dark:text-wa-text-dark">
                    {isFiltered ? activeGroup.emptyTitle : 'Todavía no enviaste ningún flujo hoy'}
                  </h3>
                  <p className="mt-1 max-w-xl text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
                    {isFiltered
                      ? 'Prueba otro período o flujo para encontrar el envío que buscas.'
                      : 'Abre una conversación y selecciona Iniciar flujo. Los envíos aparecerán aquí con su estado y sus pasos.'}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {isFiltered ? (
                      <Button variant="secondary" className="h-10" onClick={resetFilters}>
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        Quitar filtros
                      </Button>
                    ) : (
                      <>
                        <Button className="h-10 bg-wa-primary-strong hover:bg-wa-primary-deep" onClick={() => navigate('/')}>
                          <MessageSquare className="h-4 w-4" aria-hidden="true" />
                          Ir a los chats
                        </Button>
                        <Button variant="secondary" className="h-10" onClick={() => selectPeriod('week')}>Ver últimos 7 días</Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              days.map(day => (
                <section key={day.key} aria-label={dayLabel(day.key)}>
                  <h3 className="flex items-center gap-3 border-b border-wa-border bg-wa-app/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-wa-muted dark:border-wa-border-dark dark:bg-wa-app-dark/60 dark:text-wa-muted-dark sm:px-4">
                    {dayLabel(day.key)}
                    <span className="font-normal normal-case tracking-normal">
                      {day.items.length} {day.items.length === 1 ? 'envío' : 'envíos'}
                    </span>
                  </h3>
                  {day.items.map(execution => (
                    <ExecutionRow
                      key={execution.id}
                      execution={execution}
                      isCancelling={cancelExecution.isPending && cancelExecution.variables === execution.id}
                      onCancel={() => handleCancel(execution)}
                    />
                  ))}
                </section>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
