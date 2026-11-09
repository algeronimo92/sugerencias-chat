import {
AlertTriangle,Ban,CheckCircle2,ChevronDown,Clock3,Loader2,Pause,PauseCircle,Play,
Workflow,ZapOff,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { extractErrorMessage } from '../../../shared/utils/errors'
import {
ACTIVE_EXECUTION_STATUSES,AUTOMATION_TRIGGERS,AutomationExecutionStatus,automationStepLabel,
} from '../domain/automationCatalog'
import {
useAutomationExecutions,useCancelExecution,usePauseExecution,useResumeExecution,
} from '../queries'
import { followedBranchText } from '../domain/flowBranches'
import type { AutomationActionResult, AutomationExecution } from '../types'

interface Props {
  chatId: string
  /** El cliente tiene apagadas las automatizaciones nuevas (interruptor de
   *  la cabecera). Eso no detiene lo que ya está en marcha, y el panel lo dice. */
  botDisabled?: boolean
}

/** Reloj compartido por todas las cuentas regresivas del panel. Solo late
 *  mientras hay algo que contar: sin ejecuciones activas el panel no se
 *  dibuja y el intervalo no se crea. */
function useTicker(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [enabled])
  return now
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days) return `${days} d ${hours} h`
  if (hours) return `${hours} h ${minutes} min`
  if (minutes) return `${minutes} min ${seconds} s`
  return `${seconds} s`
}

function triggerLabel(trigger: string) {
  return AUTOMATION_TRIGGERS.find(item => item.value === trigger)?.label ?? trigger
}

function executionSourceLabel(execution: AutomationExecution) {
  if (execution.started_by_name) {
    return execution.start_source === 'flow'
      ? `Iniciada por ${execution.started_by_name} · llamada por otro flujo`
      : `Iniciada por ${execution.started_by_name}`
  }
  if (execution.start_source === 'manual') return 'Iniciada por un usuario eliminado'
  if (execution.start_source === 'flow') return 'Llamada por otro flujo'
  return 'Ejecutada por el sistema'
}

/** Qué le falta a la ejecución para dar su próximo paso, en texto. Con la
 *  ejecución congelada lo que queda no se mide contra ahora sino contra
 *  `paused_at`: ese es justamente el tiempo que la pausa le está guardando. */
function pendingLabel(execution: AutomationExecution, now: number) {
  if (execution.status === AutomationExecutionStatus.Running) return 'Ejecutándose ahora'
  const target = new Date(execution.scheduled_for).getTime()
  if (execution.status === AutomationExecutionStatus.Paused) {
    const frozen = execution.paused_at ? new Date(execution.paused_at).getTime() : now
    const remaining = target - frozen
    return remaining > 0
      ? `En pausa · al reanudar le quedan ${formatDuration(remaining)}`
      : 'En pausa · al reanudar sigue de inmediato'
  }
  const remaining = target - now
  return remaining > 0 ? `Continúa en ${formatDuration(remaining)}` : 'Continúa en instantes'
}

function stepDetail(step: AutomationActionResult) {
  if (step.seconds) return `espera ${formatDuration(step.seconds * 1000)}`
  if (step.branch) return followedBranchText(step.branch)
  if (step.error) return step.error
  if (step.conditions?.length) return 'espera un mensaje, el temporizador o el horario'
  return ''
}

/** Pausa o reanuda esta ejecución sola, sin tocar el resto de lo que el
 *  sistema tiene en marcha sobre el lead. No es lo mismo que cancelar: guarda
 *  lo que el flujo ya avanzó y el tiempo que le faltaba para el próximo paso.
 *  Es la única forma de detener algo que ya corre: el interruptor de la
 *  cabecera solo impide que arranquen automatizaciones nuevas.
 *
 *  Una ejecución que está enviando un paso en este instante no se puede
 *  pausar; el botón lo explica en vez de fallar. Las que quedaron pausadas
 *  "junto con el chat" por la regla anterior se reanudan desde acá igual. */
function PauseToggleButton({ execution }: { execution: AutomationExecution }) {
  const pause = usePauseExecution()
  const resume = useResumeExecution()
  const isPaused = execution.status === AutomationExecutionStatus.Paused
  const isRunning = execution.status === AutomationExecutionStatus.Running
  const isPending = pause.isPending || resume.isPending
  const label = isPaused ? 'Reanudar' : 'Pausar'

  return (
    <button
      type="button"
      title={isPaused
        ? 'Reanudar: sigue con el tiempo que le faltaba'
        : isRunning
          ? 'Está enviando un paso; podrás pausarla en su próxima espera'
          : 'Pausar aquí: guarda lo avanzado y el tiempo que le falta'}
      aria-label={`${label} ${execution.rule_name}`}
      disabled={isPending || isRunning}
      onClick={() => (isPaused ? resume : pause).mutate(execution.id, {
        onSuccess: () => toast.success(
          isPaused ? 'Automatización reanudada: sigue desde donde quedó' : 'Automatización pausada: sigue cuando la reanudes'
        ),
        onError: error => toast.error(extractErrorMessage(error)),
      })}
      className={`flex h-6 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        isPaused
          ? 'border-wa-primary-strong text-wa-primary-strong hover:bg-green-50 dark:border-wa-primary dark:text-wa-primary dark:hover:bg-green-950/30'
          : 'border-amber-600 text-amber-700 hover:bg-amber-50 dark:border-amber-400 dark:text-amber-400 dark:hover:bg-amber-950/30'
      }`}
    >
      {isPending
        ? <Loader2 className="h-3 w-3 animate-spin" />
        : isPaused
          ? <Play className="h-3 w-3" />
          : <Pause className="h-3 w-3" />}
      {label}
    </button>
  )
}

function StepIcon({ status }: { status?: string }) {
  if (status === AutomationExecutionStatus.Failed) {
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />
  }
  if (status === AutomationExecutionStatus.Scheduled) {
    return <Clock3 className="h-3.5 w-3.5 shrink-0 text-amber-500" />
  }
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-wa-primary-strong" />
}

/**
 * Lo que el sistema tiene en marcha sobre este lead, dentro del propio chat:
 * cada automatización activa (las que dispara el sistema y las que arranca el
 * vendedor), los pasos que ya dio, en qué espera está parada y cuánto le falta
 * para seguir — con botones para pausarla o cancelarla antes de que le
 * escriba al cliente.
 *
 * Sin esto el vendedor solo veía sus propios flujos manuales y no tenía cómo
 * frenar una automatización concreta: el interruptor de la cabecera solo
 * impide que arranquen nuevas, y eso hay que decirlo acá, donde se ve lo que
 * sigue.
 */
export function LeadAutomationPanel({ chatId, botDisabled = false }: Props) {
  const { data: executions = [] } = useAutomationExecutions({ chatId })
  const cancelExecution = useCancelExecution()
  const [open, setOpen] = useState(false)

  const active = executions.filter(execution => ACTIVE_EXECUTION_STATUSES.includes(execution.status))
  const now = useTicker(active.length > 0)
  if (active.length === 0) return null

  const paused = active.filter(execution => execution.status === AutomationExecutionStatus.Paused).length
  const moving = active.length - paused
  const summary = active.length === 1
    ? active[0].rule_name
    : paused === 0
      ? `${active.length} automatizaciones en marcha`
      : paused === active.length
        ? `${active.length} automatizaciones en pausa`
        : `${active.length} automatizaciones`
  const pausedNote = active.length === 1
    ? paused === 1 ? ' · en pausa' : ''
    : paused > 0 && paused < active.length ? ` · ${paused} en pausa` : ''

  return (
    <div className="border-t border-wa-border bg-wa-field text-xs dark:border-wa-border-dark dark:bg-wa-field-dark">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-wa-muted transition-colors hover:bg-black/5 dark:text-wa-muted-dark dark:hover:bg-white/5"
      >
        {paused === active.length
          ? <PauseCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          : <Workflow className="h-3.5 w-3.5 shrink-0 text-wa-primary-strong" />}
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold text-wa-text dark:text-wa-text-dark">{summary}</span>
          {pausedNote && <span className="text-amber-700 dark:text-amber-400">{pausedNote}</span>}
          {/* El único sitio donde conviven los dos estados: automatizaciones
              nuevas apagadas y algo que sigue en marcha. Sin esta frase parece
              que el interruptor falló. */}
          {botDisabled && moving > 0 && (
            <span className="text-wa-muted dark:text-wa-muted-dark">
              {' · '}
              <ZapOff className="inline h-3 w-3 align-[-2px]" aria-hidden="true" /> Sin automatizaciones nuevas: {moving === 1 ? 'esta sigue' : 'estas siguen'} en marcha
            </span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="max-h-64 space-y-2 overflow-y-auto px-3 pb-3">
          {active.map(execution => (
            <article
              key={execution.id}
              className="rounded-xl border border-wa-border bg-white px-3 py-2 dark:border-wa-border-dark dark:bg-wa-panel-dark"
            >
              <header className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-wa-text dark:text-wa-text-dark">
                    {execution.rule_name}
                  </span>
                  <span className="block truncate text-[10px] text-wa-muted dark:text-wa-muted-dark">
                    {executionSourceLabel(execution)} · {triggerLabel(execution.trigger_type)}
                  </span>
                </span>
                <PauseToggleButton execution={execution} />
                <button
                  type="button"
                  title="Cancelar: termina aquí; no se puede reanudar"
                  aria-label={`Cancelar ${execution.rule_name}`}
                  disabled={cancelExecution.isPending}
                  onClick={() => cancelExecution.mutate(execution.id, {
                    onSuccess: () => toast.success('Automatización cancelada'),
                    onError: error => toast.error(extractErrorMessage(error)),
                  })}
                  className="flex h-6 shrink-0 items-center gap-1 rounded-lg border border-red-500 px-2 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-wait disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  {cancelExecution.isPending && cancelExecution.variables === execution.id
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Ban className="h-3 w-3" />}
                  Cancelar
                </button>
              </header>

              {execution.action_results.length > 0 && (
                <ol className="mt-2 space-y-1 border-l border-dashed border-wa-border pl-3 dark:border-wa-border-dark">
                  {execution.action_results.map((step, index) => {
                    const detail = stepDetail(step)
                    return (
                      <li key={index} className="flex items-start gap-1.5 text-[11px] text-wa-muted dark:text-wa-muted-dark">
                        <StepIcon status={step.status} />
                        <span className="min-w-0 flex-1">
                          <span className="text-wa-text dark:text-wa-text-dark">
                            {step.position ?? index + 1}. {automationStepLabel(step.type)}
                          </span>
                          {detail && <span> · {detail}</span>}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              )}

              <p className={`mt-2 flex items-center gap-1.5 text-[11px] font-semibold ${
                execution.status === AutomationExecutionStatus.Paused
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-wa-primary-strong dark:text-wa-primary'
              }`}>
                {execution.status === AutomationExecutionStatus.Running
                  ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  : execution.status === AutomationExecutionStatus.Paused
                    ? <PauseCircle className="h-3.5 w-3.5 shrink-0" />
                    : <Clock3 className="h-3.5 w-3.5 shrink-0" />}
                {pendingLabel(execution, now)}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
