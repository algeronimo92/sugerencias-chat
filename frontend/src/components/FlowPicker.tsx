import { useState } from 'react'
import { Loader2, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { useAutomationExecutions, useManualFlows, useStartManualFlow } from '../hooks/useAutomations'
import { useDismissiblePopover } from '../hooks/useDismissiblePopover'
import { extractErrorMessage } from '../utils/errors'

interface Props {
  chatId: string
}

/**
 * Botón "Iniciar flujo" del chat: lista los flujos visuales de trigger
 * manual que el admin marcó visibles (o todos, si quien mira es admin) y
 * dispara uno sobre este lead puntual. Mismo patrón que TemplatePicker.
 */
export function FlowPicker({ chatId }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useDismissiblePopover<HTMLDivElement>(open, () => setOpen(false))
  const { data: flows = [], isLoading } = useManualFlows(chatId)
  // Mismo hook que usa FlowRunStatus: react-query cachea por chatId, así que
  // esto no duplica el pedido de red mientras el banner esté montado. Es solo
  // UX (deshabilita el botón y avisa "Ya en curso") — la guarda real contra
  // dos ejecuciones simultáneas es el índice único del backend, que sigue
  // respondiendo 400 aunque este chequeo llegue a estar desactualizado por
  // un refetch pendiente.
  const { data: executions = [] } = useAutomationExecutions({ chatId })
  const activeRuleIds = new Set(
    executions
      .filter(
        (execution) =>
          (execution.start_source === 'manual' || execution.start_source === 'flow') &&
          (execution.status === 'scheduled' || execution.status === 'running')
      )
      .map((execution) => execution.rule_id)
  )
  const startFlow = useStartManualFlow()

  function choose(ruleId: number, name: string) {
    startFlow.mutate(
      { ruleId, chatId },
      {
        onSuccess: () => toast.success(`Flujo "${name}" iniciado`),
        onError: (error) => toast.error(extractErrorMessage(error)),
      }
    )
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        title="Iniciar un flujo automático para este lead"
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-wa-muted hover:bg-wa-field dark:text-wa-muted-dark dark:hover:bg-wa-head-dark"
      >
        <Workflow className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute bottom-11 left-0 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-wa-border bg-white p-2 shadow-xl dark:border-wa-border-dark dark:bg-wa-head-dark">
          <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-wa-muted">
            Iniciar flujo
          </p>
          <div className="max-h-72 overflow-y-auto">
            {isLoading && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-wa-muted" />
              </div>
            )}
            {!isLoading && flows.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-wa-muted">
                No hay flujos disponibles para vendedores todavía.
              </p>
            )}
            {flows.map((flow) => {
              const alreadyRunning = activeRuleIds.has(flow.id)
              return (
                <button
                  key={flow.id}
                  type="button"
                  disabled={startFlow.isPending || alreadyRunning}
                  onClick={() => choose(flow.id, flow.name)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-wa-hover disabled:cursor-wait disabled:opacity-50 dark:hover:bg-wa-active-dark"
                >
                  <Workflow className="h-4 w-4 shrink-0 text-wa-primary-strong" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-wa-text dark:text-white">
                    {flow.name}
                  </span>
                  {alreadyRunning && (
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-wa-muted">
                      Ya en curso
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
