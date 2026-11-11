import { Loader2, Workflow } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useDismissiblePopover } from '../../../shared/hooks/useDismissiblePopover'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useAutomationExecutions, useManualFlows, useStartManualFlow } from '../queries'

interface Props {
  chatId: string
}

/**
 * Botón "Iniciar flujo" del chat: lista los flujos visuales de trigger
 * manual que el admin marcó visibles (o todos, si quien mira es admin) y
 * dispara uno sobre este lead puntual. Mismo patrón que TemplatePicker.
 *
 * Vive en la cabecera del hilo, junto al interruptor de automatizaciones, y no en la fila de
 * composición: ahí estaba pegado a "Plantillas" con el mismo icono gris, a
 * 36 px y sin nombre accesible (solo `title`, que no existe en táctil). Una
 * admin lanzó un flujo creyendo que mandaba una plantilla. El popover abre
 * hacia abajo y alineado a la derecha porque ahora cuelga de la cabecera.
 */
export function FlowPicker({ chatId }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useDismissiblePopover<HTMLDivElement>(open, () => setOpen(false))
  // Solo con el popover abierto: el picker vive montado en el composer de
  // cada chat y la lista no hace falta hasta que el vendedor la pide.
  const { data: flows = [], isPending: isLoading } = useManualFlows(chatId, { enabled: open })
  // Mismo hook que usa LeadAutomationPanel: react-query cachea por chatId, así
  // que esto no duplica el pedido de red mientras el panel esté montado. La
  // lista trae también las ejecuciones de sistema del lead, por eso el filtro
  // por start_source de abajo: solo un flujo del vendedor bloquea. Es solo
  // UX (deshabilita el botón y avisa "Ya en curso") — la guarda real contra
  // dos ejecuciones simultáneas es el índice único del backend, que sigue
  // respondiendo 400 aunque este chequeo llegue a estar desactualizado por
  // un refetch pendiente.
  const { data: executions = [] } = useAutomationExecutions({ chatId })
  const activeRuleIds = new Set<number>()
  for (const execution of executions) {
    const isSellerFlow = execution.start_source === 'manual' || execution.start_source === 'flow'
    const isActive = execution.status === 'scheduled' || execution.status === 'running'
    if (isSellerFlow && isActive) activeRuleIds.add(execution.rule_id)
  }
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
    // `sm:relative` y no `relative`: en el celular el botón queda en el medio
    // de la cabecera (a su derecha van cita, "más" y ficha), así que un menú
    // de 288 px anclado a su borde derecho se salía ~60 px por la izquierda
    // de la pantalla y cortaba los nombres. Sin contenedor posicionado, el
    // menú se ancla al hilo del chat (`relative` en ChatThread) y cuelga bajo
    // la cabecera (h-16) pegado al borde derecho de la pantalla.
    <div ref={containerRef} className="sm:relative">
      <button
        type="button"
        aria-label="Iniciar un flujo para este lead"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Iniciar un flujo automático para este lead"
        onClick={() => setOpen((current) => !current)}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${
          open ? 'bg-black/5 text-wa-primary-strong dark:bg-white/5 dark:text-wa-primary' : 'text-wa-muted dark:text-wa-muted-dark'
        }`}
      >
        <Workflow className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-2 top-[4.25rem] z-30 w-72 sm:right-0 sm:top-12 max-w-[calc(100vw-2rem)] rounded-xl border border-wa-border bg-white p-2 shadow-xl dark:border-wa-border-dark dark:bg-wa-head-dark">
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
