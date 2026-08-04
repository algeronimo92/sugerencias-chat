import { Loader2, Workflow, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAutomationExecutions, useCancelExecution, useManualFlows } from '../hooks/useAutomations'
import { extractErrorMessage } from '../utils/errors'

interface Props {
  chatId: string
}

/**
 * Un banner "Flujo 'X' en curso — paso N/M" por cada ejecución manual
 * (disparada por un vendedor con FlowPicker) que sigue scheduled/running
 * sobre este chat — puede haber más de una si el vendedor lo arrancó dos
 * veces antes de que la guarda de reentrada del backend lo bloqueara, o si
 * dos vendedores lo arrancaron casi a la vez. No hay WebSocket dedicado a
 * automation_executions: useAutomationExecutions hace poll corto mientras
 * haya una ejecución activa (ver useAutomations.ts).
 */
export function FlowRunStatus({ chatId }: Props) {
  const { data: executions = [] } = useAutomationExecutions({ chatId })
  // Mismo hook que usa FlowPicker: react-query cachea por chatId, así que esto
  // no duplica el pedido de red mientras el picker esté montado.
  const { data: flows = [] } = useManualFlows(chatId)
  const cancelExecution = useCancelExecution()

  const active = executions.filter(
    (execution) =>
      execution.start_source === 'manual' &&
      (execution.status === 'scheduled' || execution.status === 'running')
  )
  if (active.length === 0) return null

  return (
    <>
      {active.map((execution) => {
        const flow = flows.find((item) => item.id === execution.rule_id)
        const totalSteps = flow && 'nodes' in flow.flow_definition ? flow.flow_definition.nodes.length : null
        const currentStep = execution.flow_state.path?.length ?? 0

        return (
          <div
            key={execution.id}
            className="flex items-center gap-2 border-t border-wa-border bg-wa-field px-3 py-2 text-xs text-wa-muted dark:border-wa-border-dark dark:bg-wa-field-dark dark:text-wa-muted-dark"
          >
            {execution.status === 'running' ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-wa-primary-strong" />
            ) : (
              <Workflow className="h-3.5 w-3.5 shrink-0 text-wa-primary-strong" />
            )}
            <span className="min-w-0 flex-1 truncate">
              Flujo <span className="font-semibold text-wa-text dark:text-wa-text-dark">"{execution.rule_name}"</span> en curso
              {totalSteps ? ` — paso ${Math.min(currentStep, totalSteps)}/${totalSteps}` : ''}
            </span>
            <button
              type="button"
              title="Cancelar flujo"
              aria-label="Cancelar flujo"
              disabled={cancelExecution.isPending}
              onClick={() => cancelExecution.mutate(execution.id, {
                onError: (error) => toast.error(extractErrorMessage(error)),
              })}
              className="shrink-0 rounded-full p-1 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text disabled:cursor-wait disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-wa-text-dark"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </>
  )
}
