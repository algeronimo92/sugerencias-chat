import { Beaker, Info, Loader2, LocateFixed, Play, Search, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../../shared/ui/Button'
import { Input } from '../../../../shared/ui/Input'
import { Modal } from '../../../../shared/ui/Modal'
import { extractErrorMessage } from '../../../../shared/utils/errors'
import type { Chat } from '../../../leads/types'
import { useLeadSearch } from '../../../leads/public/useLeadSearch'
import { useLeadStageCatalog } from '../../../leads/public/useLeadStages'
import { FlowNodeType, automationStepLabel, formatWaitDuration } from '../../domain/automationCatalog'
import { flowBranchName } from '../../domain/flowBranches'
import { stepStatusLabel } from '../../utils/automationExecutions'
import type { AutomationFlowSimulation } from '../../queries'

interface FlowSimulationDialogProps {
  isSimulating: boolean
  onSimulate: (leadId: string) => Promise<AutomationFlowSimulation | null>
  onClose: () => void
  /** Número (#n) de cada bloque, el mismo del lienzo. */
  numbers: ReadonlyMap<string, number>
  /** Cierra la prueba y lleva al bloque de ese paso. */
  onGoToNode: (nodeId: string) => void
}

/** Se lee «Condición · sale por la condición que se cumplió»: las salidas
 *  propias de un bloque (grupos de una Condición) no tienen nombre fijo. */
function branchLabel(branch: string) {
  return flowBranchName(branch) ?? 'la condición que se cumplió'
}

export function FlowSimulationDialog({ isSimulating, onSimulate, onClose, numbers, onGoToNode }: FlowSimulationDialogProps) {
  const [draftSearch, setDraftSearch] = useState('')
  const stageCatalog = useLeadStageCatalog()
  const [submittedSearch, setSubmittedSearch] = useState('')
  const [selectedLead, setSelectedLead] = useState<Chat | null>(null)
  const [simulation, setSimulation] = useState<AutomationFlowSimulation | null>(null)
  const leads = useLeadSearch(submittedSearch)
  const results = leads.data ?? []

  async function simulate() {
    if (!selectedLead) return
    setSimulation(await onSimulate(selectedLead.chat_id))
  }

  return (
    <Modal
      title="Probar el flujo"
      description="Guarda el borrador y muestra la ruta que seguiría un lead con sus datos de hoy. No se le envía nada."
      icon={<Beaker className="h-4 w-4" />}
      size="md"
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        <Button disabled={!selectedLead || isSimulating} onClick={() => void simulate()}>
          {isSimulating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {selectedLead ? `Probar con ${selectedLead.name || 'este lead'}` : 'Elige un lead'}
        </Button>
      </>}
    >
      <div className="space-y-4">
        <form role="search" className="flex gap-2" onSubmit={event => { event.preventDefault(); setSubmittedSearch(draftSearch) }}>
          <Input value={draftSearch} onChange={event => setDraftSearch(event.target.value)} placeholder="Buscar lead por nombre o teléfono" aria-label="Buscar lead" autoFocus />
          <Button type="submit" variant="secondary" disabled={leads.isFetching} aria-label="Buscar">
            {leads.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </form>
        {leads.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{extractErrorMessage(leads.error)}</p>}
        {results.length > 0 && (
          <div role="listbox" aria-label="Leads encontrados" className="max-h-48 overflow-y-auto rounded-xl border border-wa-border dark:border-wa-border-dark">
            {results.map(lead => {
              const active = selectedLead?.chat_id === lead.chat_id
              return (
                <button
                  key={lead.chat_id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => setSelectedLead(lead)}
                  className={`flex w-full items-center gap-2.5 border-b border-wa-border px-3 py-2.5 text-left outline-none last:border-0 focus-visible:bg-wa-hover dark:border-wa-border-dark dark:focus-visible:bg-wa-hover-dark ${active ? 'bg-wa-primary/10' : 'hover:bg-wa-hover dark:hover:bg-wa-hover-dark'}`}
                >
                  <UserRound className="h-4 w-4 shrink-0 text-wa-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{lead.name || 'Sin nombre'}</span>
                    <span className="block text-xs text-wa-muted dark:text-wa-muted-dark">{lead.phone || lead.chat_id} · {stageCatalog.label(lead.stage)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {simulation && (
          <section aria-label="Resultado de la prueba" className="space-y-2">
            <h3 className="text-sm font-semibold">Ruta para {simulation.lead_name || simulation.lead_id}</h3>
            <ol className="space-y-1.5">
              {simulation.path.map((step, index) => {
                const number = step.node_id ? numbers.get(step.node_id) : undefined
                const failed = step.status === 'would_fail'
                return (
                  <li key={index} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs ${failed ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200' : 'border-wa-border bg-wa-hover text-wa-text dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark'}`}>
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-wa-border px-1 text-[10px] font-bold tabular-nums dark:bg-wa-active-dark">{number != null ? `#${number}` : index + 1}</span>
                    <span className="min-w-0 flex-1 leading-relaxed">
                      <strong className="font-semibold">{automationStepLabel(String(step.type))}</strong>
                      {step.status ? ` · ${stepStatusLabel(step.status)}` : ''}
                      {step.branch && step.type !== FlowNodeType.RoundRobin ? ` · sale por ${branchLabel(step.branch)}` : ''}
                      {step.seconds ? ` · ${formatWaitDuration(step.seconds)}` : ''}
                      {step.detail ? <span className="block opacity-80">{String(step.detail)}</span> : null}
                    </span>
                    {step.node_id && number != null && (
                      <Button variant="ghost" size="sm" onClick={() => onGoToNode(step.node_id as string)} aria-label={`Ver bloque #${number}`} className="-my-0.5 h-6 px-1.5">
                        <LocateFixed className="h-3 w-3" aria-hidden="true" />Ver
                      </Button>
                    )}
                  </li>
                )
              })}
            </ol>
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-wa-muted dark:text-wa-muted-dark">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              En pausas y preguntas sigue la salida del temporizador o «Sin respuesta»: no puede saber qué responderá el lead.
            </p>
          </section>
        )}
      </div>
    </Modal>
  )
}
