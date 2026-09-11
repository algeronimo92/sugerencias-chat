import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, Loader2, MessageCircle, Send, XCircle } from 'lucide-react'
import { useAutomationExecutions, useManualFlows } from '../hooks/useAutomations'
import {
  AutomationExecutionStatus, type AutomationExecutionStatusValue,
} from '../domain/automationCatalog'
import {
  EXECUTION_STATUS_LABELS,
  executionActorLabel,
  executionStatusLabel,
  executionTone,
  executionTriggerLabel,
  formatExecutionDate as formatDate,
  isExecutionStatus,
  todayISODate,
} from '../utils/automationExecutions'
import { Checkbox } from './ui/Checkbox'
import { Select } from './ui/Input'

/** "A quién le mandé el flujo Yape" sin tener que abrir lead por lead: el
 *  vendedor ve acá solo lo que él mismo disparó a mano (el backend lo acota
 *  por started_by_user_id con `mine=true`, nunca ejecuciones de otros
 *  vendedores), filtrando por flujo, estado/actividad y rango de fechas
 *  (por defecto hoy). Es la versión reducida del tab Historial de
 *  AutomationsPage (admin-only): sin CRUD de reglas ni reintentos. */
export function MyAutomationExecutionsPage() {
  const navigate = useNavigate()
  const { data: flows = [] } = useManualFlows()
  const [ruleId, setRuleId] = useState<number | null>(null)
  const [status, setStatus] = useState<AutomationExecutionStatusValue | null>(null)
  const [active, setActive] = useState<boolean | null>(null)
  const [hideSkipped, setHideSkipped] = useState(true)
  const [dateFrom, setDateFrom] = useState(todayISODate)
  const [dateTo, setDateTo] = useState(todayISODate)
  const excludeSkipped = hideSkipped && status !== AutomationExecutionStatus.Skipped
  const { data: executions = [], isLoading, isFetching } = useAutomationExecutions({
    mine: true,
    ruleId: ruleId ?? undefined,
    status: status ?? undefined,
    excludeSkipped,
    active: active ?? undefined,
    dateFrom,
    dateTo,
  })

  const today = todayISODate()
  const hasCustomFilters = ruleId !== null || status !== null || !hideSkipped
    || active !== null || dateFrom !== today || dateTo !== today

  function resetFilters() {
    setRuleId(null)
    setStatus(null)
    setHideSkipped(true)
    setActive(null)
    setDateFrom(today)
    setDateTo(today)
  }

  function setStatusFilter(value: AutomationExecutionStatusValue | null) {
    setStatus(value)
    if (value !== null) setActive(null)
  }

  function setActiveFilter(value: boolean | null) {
    setActive(value)
    if (value !== null) setStatus(null)
  }

  return (
    <div className="h-full overflow-y-auto bg-wa-app p-4 dark:bg-wa-app-dark sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex items-center gap-2">
          <Send className="h-5 w-5 text-wa-primary-strong" />
          <div>
            <h1 className="text-xl font-semibold text-wa-text dark:text-white">Flujos enviados</h1>
            <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">A qué leads les mandaste cada flujo, y si sigue activo.</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-panel-dark">
          <div className="flex flex-wrap items-end gap-3 border-b border-wa-border bg-wa-hover/60 p-3 dark:border-wa-border-dark dark:bg-wa-head-dark/40">
            <label className="grid min-w-48 flex-1 gap-1 text-[10px] font-semibold uppercase tracking-wide text-wa-muted">Flujo
              <Select value={ruleId ?? ''} onChange={event => setRuleId(event.target.value ? Number(event.target.value) : null)} className="rounded-lg border border-wa-border bg-white px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-gray-700 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark">
                <option value="">Todos</option>
                {flows.map(flow => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
              </Select>
            </label>
            <label className="grid min-w-44 flex-1 gap-1 text-[10px] font-semibold uppercase tracking-wide text-wa-muted">Estado
              <Select value={status ?? ''} onChange={event => setStatusFilter(isExecutionStatus(event.target.value) ? event.target.value : null)} className="rounded-lg border border-wa-border bg-white px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-gray-700 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark">
                <option value="">Todos los estados</option>
                {Object.entries(EXECUTION_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
            <div className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-wa-muted">Actividad
              <div className="flex rounded-lg bg-wa-border p-1 dark:bg-wa-head-dark">
                <button type="button" onClick={() => setActiveFilter(null)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold normal-case tracking-normal ${active === null ? 'bg-white text-wa-text shadow dark:bg-wa-active-dark dark:text-white' : 'text-wa-muted dark:text-wa-muted-dark'}`}>Todos</button>
                <button type="button" onClick={() => setActiveFilter(true)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold normal-case tracking-normal ${active === true ? 'bg-white text-wa-text shadow dark:bg-wa-active-dark dark:text-white' : 'text-wa-muted dark:text-wa-muted-dark'}`}>Activos</button>
                <button type="button" onClick={() => setActiveFilter(false)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold normal-case tracking-normal ${active === false ? 'bg-white text-wa-text shadow dark:bg-wa-active-dark dark:text-white' : 'text-wa-muted dark:text-wa-muted-dark'}`}>Finalizados</button>
              </div>
            </div>
            <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-wa-muted">Desde
              <input type="date" value={dateFrom} max={dateTo} onChange={event => setDateFrom(event.target.value)} className="rounded-lg border border-wa-border bg-white px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-gray-700 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark" />
            </label>
            <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-wa-muted">Hasta
              <input type="date" value={dateTo} min={dateFrom} onChange={event => setDateTo(event.target.value)} className="rounded-lg border border-wa-border bg-white px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-gray-700 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark" />
            </label>
            <label className={`flex min-h-9 items-center gap-2 rounded-lg border border-wa-border bg-white px-3 py-2 text-xs text-gray-600 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-gray-300 ${status === AutomationExecutionStatus.Skipped ? 'opacity-50' : ''}`}>
              <Checkbox checked={excludeSkipped} disabled={status === AutomationExecutionStatus.Skipped} onChange={event => setHideSkipped(event.target.checked)} />
              Ocultar omitidas
            </label>
            {hasCustomFilters && <button type="button" onClick={resetFilters} className="min-h-9 rounded-lg px-3 py-2 text-xs font-semibold text-wa-primary-strong hover:bg-green-50 dark:text-wa-primary dark:hover:bg-green-950/40">Limpiar filtros</button>}
            <span className="ml-auto flex min-h-9 items-center gap-1.5 text-[11px] text-wa-muted">{isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{executions.length} resultados</span>
          </div>

          {isLoading ? (
            <div className="flex justify-center px-4 py-16"><Loader2 className="h-6 w-6 animate-spin text-wa-muted" /></div>
          ) : executions.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-wa-muted">No mandaste ningún flujo que coincida con estos filtros.</p>
          ) : executions.map(execution => (
            <details key={execution.id} className="group border-b border-wa-border last:border-0 dark:border-wa-border-dark">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-wa-hover dark:hover:bg-wa-head-dark/60">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${executionTone(execution.status)}`}>
                  {execution.status === AutomationExecutionStatus.Completed ? <CheckCircle2 className="h-4 w-4" />
                    : execution.status === AutomationExecutionStatus.Failed ? <XCircle className="h-4 w-4" />
                    : execution.status === AutomationExecutionStatus.Skipped ? <AlertTriangle className="h-4 w-4" />
                    : <Clock3 className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-gray-800 dark:text-wa-text-dark">{execution.rule_name}</span>
                  <span className="block truncate text-[10px] text-wa-muted">{execution.lead_name || execution.lead_id || 'Lead eliminado'} · {executionTriggerLabel(execution.trigger_type)} · Enviado por {executionActorLabel(execution)} · {formatDate(execution.created_at)}</span>
                </span>
                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${executionTone(execution.status)}`}>{executionStatusLabel(execution.status)}</span>
                <ChevronDown className="h-4 w-4 text-wa-muted transition-transform group-open:rotate-180" />
              </summary>
              {execution.rule_deleted && <div className="border-t border-wa-border bg-amber-50 px-4 py-2 text-[11px] text-amber-700 dark:border-wa-border-dark dark:bg-amber-950/30 dark:text-amber-300">Flujo eliminado · se conserva en el historial solo para auditoría.</div>}
              <div className="bg-wa-hover px-4 py-3 text-xs dark:bg-wa-app-dark/60">
                <p className="text-wa-muted">Programado: {formatDate(execution.scheduled_for)} · Finalizado: {formatDate(execution.finished_at)}</p>
                {execution.error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/40 dark:text-red-300">{execution.error}</p>}
                {execution.lead_id && (
                  <button
                    type="button"
                    onClick={() => navigate(`/chat/${encodeURIComponent(execution.lead_id!)}`)}
                    className="mt-3 flex items-center gap-1.5 rounded-lg border border-wa-primary-strong px-3 py-1.5 text-[11px] font-semibold text-wa-primary-strong hover:bg-green-50 dark:text-wa-primary dark:hover:bg-green-950/40"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    Ir al chat
                  </button>
                )}
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  )
}
