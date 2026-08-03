import { Loader2, Workflow, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAutomationExecutions, useCancelExecution, useManualFlows } from '../hooks/useAutomations'
import { extractErrorMessage } from '../utils/errors'

interface Props {
  chatId: string
}

/**
 * Banner "Flujo 'X' en curso — paso N/M" para la ejecución manual (disparada
 * por un vendedor con FlowPicker) que sigue scheduled/running sobre este
 * chat. No hay WebSocket dedicado a automation_executions: useAutomationExecutions
 * hace poll corto mientras haya una ejecución activa (ver useAutomations.ts).
 */
export function FlowRunStatus({ chatId }: Props) {
  const { data: executions = [] } = useAutomationExecutions({ chatId })
  // Mismo hook que usa FlowPicker: react-query cachea por chatId, así que esto
  // no duplica el pedido de red mientras el picker esté montado.
  const { data: flows = [] } = useManualFlows(chatId)
  const cancelExecution = useCancelExecution()

  const active = executions.find(
    (execution) =>
      execution.start_source === 'manual' &&
      (execution.status === 'scheduled' || execution.status === 'running')
  )
  if (!active) return null

  const flow = flows.find((item) => item.id === active.rule_id)
  const totalSteps = flow && 'nodes' in flow.flow_definition ? flow.flow_definition.nodes.length : null
  const currentStep = active.flow_state.path?.length ?? 0

  return (
    <div className="flex items-center gap-2 border-t border-wa-border bg-wa-field px-3 py-2 text-xs text-wa-muted dark:border-wa-border-dark dark:bg-wa-field-dark dark:text-wa-muted-dark">
      {active.status === 'running' ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-wa-primary-strong" />
      ) : (
        <Workflow className="h-3.5 w-3.5 shrink-0 text-wa-primary-strong" />
      )}
      <span className="min-w-0 flex-1 truncate">
        Flujo <span className="font-semibold text-wa-text dark:text-wa-text-dark">"{active.rule_name}"</span> en curso
        {totalSteps ? ` — paso ${Math.min(currentStep, totalSteps)}/${totalSteps}` : ''}
      </span>
      <button
        type="button"
        title="Cancelar flujo"
        aria-label="Cancelar flujo"
        disabled={cancelExecution.isPending}
        onClick={() => cancelExecution.mutate(active.id, {
          onError: (error) => toast.error(extractErrorMessage(error)),
        })}
        className="shrink-0 rounded-full p-1 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text disabled:cursor-wait disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-wa-text-dark"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
