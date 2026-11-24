import { Loader2, Workflow } from 'lucide-react'
import { useState } from 'react'
import { useDismissiblePopover } from '../../../shared/hooks/useDismissiblePopover'
import { Tooltip } from '../../../shared/ui/Tooltip'
import { useAutomationExecutions, useManualFlows } from '../queries'
import type { AutomationExecution } from '../types'
import { recentSends } from '../utils/automationExecutions'
import type { ChosenFlow } from './FlowStartConfirmation'

interface Props {
  chatId: string
  /** Elegir no inicia nada: quien monta el picker pide la confirmación
   *  (FlowStartConfirmation) y recién ahí se lanza. */
  onChoose: (flow: ChosenFlow) => void
}

/** Flujos del vendedor que todavía corren sobre el lead. La lista trae también
 *  las ejecuciones de sistema, por eso el filtro por start_source: solo un
 *  flujo del vendedor bloquea. Es solo UX (deshabilita y avisa "Ya en curso");
 *  la guarda real contra dos ejecuciones simultáneas es el índice único del
 *  backend, que sigue respondiendo 400 aunque esto llegue desactualizado. */
function activeSellerRuleIds(executions: AutomationExecution[]): Set<number> {
  const ids = new Set<number>()
  for (const execution of executions) {
    const isSellerFlow = execution.start_source === 'manual' || execution.start_source === 'flow'
    const isActive = execution.status === 'scheduled' || execution.status === 'running'
    if (isSellerFlow && isActive) ids.add(execution.rule_id)
  }
  return ids
}

/**
 * Botón "Iniciar automatización" del cuadro de escritura: lista los flujos visuales de
 * trigger manual que el admin marcó visibles (o todos, si quien mira es admin)
 * y dispara uno sobre este lead puntual. Mismo patrón que TemplatePicker.
 *
 * Volvió a la fila de composición (2026-11-19, a pedido: la cabecera
 * necesitaba lugar para la etapa y la vendedora). Ya estuvo ahí, pegado a
 * "Plantillas" con el mismo icono gris, a 36 px y sin nombre accesible (solo
 * `title`, que no existe en táctil), y una admin lanzó un flujo creyendo que
 * mandaba una plantilla. Por eso ahora lleva el color de acento (no el gris
 * de los demás), nombre accesible, tooltip y un separador antes; quien lo
 * monte en el compositor tiene que respetar ese separador.
 */
export function FlowPicker({ chatId, onChoose }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useDismissiblePopover<HTMLDivElement>(open, () => setOpen(false))

  function choose(flow: ChosenFlow) {
    onChoose(flow)
    setOpen(false)
  }

  return (
    // Sin `relative`: la lista se ancla a la píldora del cuadro de escritura,
    // igual que la de plantillas, para no cortarse contra la columna del chat.
    <div ref={containerRef}>
      <Tooltip content={open ? null : 'Iniciar una automatización'} side="top">
        <button
          type="button"
          aria-label="Iniciar una automatización para este lead"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-accent-strong outline-none transition-colors hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring ${open ? 'bg-accent-soft' : ''}`}
        >
          <Workflow className="h-4.5 w-4.5" aria-hidden="true" />
        </button>
      </Tooltip>
      {open && <FlowList chatId={chatId} onChoose={choose} />}
    </div>
  )
}

/** Montada solo con el menú abierto: la lista no hace falta hasta que el
 *  vendedor la pide, y el picker vive en el compositor de cada chat. */
function FlowList({ chatId, onChoose }: {
  chatId: string
  onChoose: (flow: ChosenFlow) => void
}) {
  const { data: flows = [], isPending: isLoading } = useManualFlows(chatId, { enabled: true })
  // Mismo hook que LeadAutomationPanel: react-query cachea por chatId y no
  // duplica el pedido mientras el panel esté montado.
  const { data: executions = [] } = useAutomationExecutions({ chatId })
  const activeRuleIds = activeSellerRuleIds(executions)
  // La lista vive unos segundos abierta: la hora de montaje alcanza.
  const [openedAt] = useState(() => Date.now())
  const sentNotes = recentSends(executions, openedAt)

  return (
    <div className="absolute inset-x-0 bottom-full z-30 mb-2 rounded-xl border border-line bg-surface-raised p-2 shadow-popover sm:left-auto sm:w-72 sm:max-w-full">
      <p className="px-2 pb-1.5 pt-1 text-xs font-semibold text-fg-muted">Iniciar automatización</p>
      <div className="max-h-72 overflow-y-auto">
        {isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-fg-muted" />
          </div>
        )}
        {!isLoading && flows.length === 0 && (
          <p className="px-2 py-3 text-center text-sm text-fg-muted">Todavía no hay automatizaciones que tu equipo pueda lanzar.</p>
        )}
        {flows.map((flow) => {
          const alreadyRunning = activeRuleIds.has(flow.id)
          const sentNote = alreadyRunning ? undefined : sentNotes.get(flow.id)
          return (
            <button
              key={flow.id}
              type="button"
              disabled={alreadyRunning}
              onClick={() => onChoose({ id: flow.id, name: flow.name })}
              className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Workflow className="h-4 w-4 shrink-0 text-accent-strong" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{flow.name}</span>
                {sentNote && <span className="block truncate text-xs text-warning-fg">{sentNote}</span>}
              </span>
              {alreadyRunning && <span className="shrink-0 text-xs font-medium text-fg-muted">Ya en curso</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
