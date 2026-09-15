import { useState } from 'react'
import { Beaker, Loader2, Play, UserRound, X } from 'lucide-react'
import type { AutomationFlowSimulation } from '../../hooks/useAutomations'
import { useLeadSearch } from '../../hooks/useLeadSearch'
import { FlowHandle } from '../../domain/automationCatalog'
import type { Chat } from '../../types'
import { extractErrorMessage } from '../../utils/errors'

const FIELD_CLASS = 'w-full rounded-lg border border-wa-border bg-white px-2.5 py-2 text-xs text-wa-text outline-none focus:border-wa-primary focus:ring-2 focus:ring-wa-primary/20 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark'

interface FlowSimulationDialogProps {
  isSimulating: boolean
  onSimulate: (leadId: string) => Promise<AutomationFlowSimulation | null>
  onClose: () => void
}

function branchLabel(branch: string) {
  if (branch === FlowHandle.No) return 'Ninguna'
  if (branch === FlowHandle.Yes) return 'Sí'
  return 'coincidente'
}

export function FlowSimulationDialog({ isSimulating, onSimulate, onClose }: FlowSimulationDialogProps) {
  const [draftSearch, setDraftSearch] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState('')
  const [selectedLead, setSelectedLead] = useState<Chat | null>(null)
  const [simulation, setSimulation] = useState<AutomationFlowSimulation | null>(null)
  const leads = useLeadSearch(submittedSearch)
  const results = leads.data ?? []

  async function simulate() {
    if (!selectedLead) return
    setSimulation(await onSimulate(selectedLead.chat_id))
  }

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"><div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-wa-panel-dark"><div className="flex items-start justify-between"><div><h2 className="flex items-center gap-2 text-sm font-semibold text-wa-text dark:text-white"><Beaker className="h-4 w-4 text-wa-primary-strong" />Simular sin ejecutar acciones</h2><p className="mt-1 text-[11px] text-wa-muted">Guarda el borrador y recorre el flujo con los datos actuales de un lead.</p></div><button type="button" onClick={onClose} className="text-wa-muted"><X className="h-5 w-5" /></button></div><div className="mt-4 flex gap-2"><input value={draftSearch} onChange={event => setDraftSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') setSubmittedSearch(draftSearch) }} placeholder="Buscar por nombre o teléfono" className={FIELD_CLASS} /><button type="button" disabled={leads.isFetching} onClick={() => setSubmittedSearch(draftSearch)} className="rounded-lg bg-wa-head-dark px-3 text-xs font-semibold text-white disabled:opacity-40 dark:bg-wa-active-dark">Buscar</button></div>{leads.isError && <p className="mt-2 text-[11px] text-red-600">{extractErrorMessage(leads.error)}</p>}{results.length > 0 && <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-wa-border dark:border-wa-border-dark">{results.map(lead => <button key={lead.chat_id} type="button" onClick={() => setSelectedLead(lead)} className={`flex w-full items-center gap-2 border-b border-wa-border px-3 py-2 text-left last:border-0 dark:border-wa-border-dark ${selectedLead?.chat_id === lead.chat_id ? 'bg-green-50 dark:bg-green-950/30' : ''}`}><UserRound className="h-4 w-4 text-wa-muted" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-gray-800 dark:text-wa-text-dark">{lead.name || 'Sin nombre'}</span><span className="block text-[10px] text-wa-muted">{lead.phone || lead.chat_id} · {lead.stage}</span></span></button>)}</div>}<button type="button" disabled={!selectedLead || isSimulating} onClick={() => void simulate()} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-wa-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{isSimulating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Recorrer flujo</button>{simulation && <div className="mt-4"><p className="mb-2 text-xs font-semibold text-gray-800 dark:text-wa-text-dark">Ruta para {simulation.lead_name || simulation.lead_id}</p><div className="space-y-1.5">{simulation.path.map((step, index) => <div key={index} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[10px] ${step.status === 'would_fail' ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300' : 'border-wa-border bg-wa-hover text-gray-600 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-gray-300'}`}><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-wa-border font-bold dark:bg-wa-active-dark">{index + 1}</span><span><strong>{String(step.type)}</strong>{step.branch ? ` · rama ${branchLabel(step.branch)}` : ''}{step.minutes ? ` · ${String(step.minutes)} min` : ''}{step.detail ? <span className="block opacity-80">{String(step.detail)}</span> : null}</span></div>)}</div></div>}</div></div>
}
