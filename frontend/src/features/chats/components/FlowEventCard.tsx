import { AlertTriangle, CheckCircle2, Clock3, Loader2, PauseCircle, Workflow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AutomationExecution } from '../../automations/types'
import { formatMessageTime } from '../../whatsapp/public/message'

/** Cómo quedó la ejecución, en una palabra y un ícono. */
function outcome(execution: AutomationExecution): { label: string; Icon: LucideIcon; tone: string } {
  switch (execution.status) {
    case 'completed':
      return { label: 'Completado', Icon: CheckCircle2, tone: 'text-wa-primary-strong dark:text-wa-primary' }
    case 'failed':
      return { label: 'Con error', Icon: AlertTriangle, tone: 'text-red-600 dark:text-red-400' }
    case 'paused':
      return { label: 'En pausa', Icon: PauseCircle, tone: 'text-amber-600 dark:text-amber-400' }
    case 'running':
      return { label: 'En curso', Icon: Loader2, tone: 'text-wa-primary-strong dark:text-wa-primary' }
    default:
      return { label: 'Programado', Icon: Clock3, tone: 'text-amber-600 dark:text-amber-400' }
  }
}

/** Quién lo puso en marcha. Un flujo hijo nombra al flujo que lo llamó. */
function starterLabel(execution: AutomationExecution): string {
  if (execution.start_source === 'flow') {
    return execution.parent_rule_name ? `El flujo ${execution.parent_rule_name} inició` : 'Otro flujo inició'
  }
  if (execution.started_by_name) return `${execution.started_by_name} inició el flujo`
  return 'Se inició el flujo'
}

/**
 * Evento del hilo: un flujo que alguien lanzó sobre este chat, en el momento
 * en que lo lanzó, con cómo terminó. Responde la pregunta que el panel de
 * automatizaciones (solo ejecuciones activas) no puede: "¿arrancó el flujo o
 * no?" cuando ya terminó o nunca empezó. Sigue el patrón de StageChangeCard.
 */
export function FlowEventCard({ execution }: { execution: AutomationExecution }) {
  const { label, Icon, tone } = outcome(execution)
  const finishedAt = execution.finished_at ? formatMessageTime(execution.finished_at) : null

  return (
    <div className="my-2 flex justify-center" data-testid="flow-event">
      <div className="max-w-[85%] rounded-xl border border-wa-border bg-white px-3.5 py-2 text-center shadow-sm dark:border-wa-border-dark dark:bg-wa-head-dark">
        <p className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-wa-text dark:text-wa-text-dark">
          <Workflow aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-wa-muted dark:text-wa-muted-dark" />
          <span>
            {starterLabel(execution)} <span className="font-semibold">{execution.rule_name}</span>
          </span>
        </p>
        <p className={`mt-1 flex items-center justify-center gap-1 text-[11px] font-semibold ${tone}`}>
          <Icon aria-hidden="true" className={`h-3 w-3 ${execution.status === 'running' ? 'animate-spin' : ''}`} />
          {label}
          <span className="font-normal text-wa-muted dark:text-wa-muted-dark">
            {' · '}{formatMessageTime(execution.created_at)}
            {finishedAt && execution.status !== 'running' && finishedAt !== formatMessageTime(execution.created_at) ? ` → ${finishedAt}` : ''}
          </span>
        </p>
        {execution.status === 'failed' && execution.error && (
          <p className="mx-auto mt-1 max-w-prose text-[11px] leading-relaxed text-wa-muted dark:text-wa-muted-dark">
            {execution.error}
          </p>
        )}
      </div>
    </div>
  )
}
