import { useCallback, useMemo, useState } from 'react'
import {
  Activity, ArrowRight, Beaker, CheckCircle2, Clock3, History, LayoutGrid,
  ListFilter, Loader2, MessageSquareText, Play, Save, Split, UserRound, X, Zap,
} from 'lucide-react'
import { FlowCanvas } from './flow/FlowCanvas'
import client from '../api/client'
import type {
  AppUser, AutomationAction, AutomationActionType, AutomationConditions,
  AutomationFlowDefinition, AutomationFlowEdge, AutomationFlowNode,
  AutomationFlowNodeType, AutomationRule, Chat, Tag,
} from '../types'
import { isLeadStage, LEAD_STAGES } from '../types'
import {
  useCreateVisualFlow, useFlowVersions, usePublishVisualFlow, useRestoreFlowVersion,
  useSaveVisualFlow, useSimulateVisualFlow, useUpdateAutomation,
  type AutomationFlowSimulation,
} from '../hooks/useAutomations'
import { useUsers } from '../hooks/useUsers'
import { useTags } from '../hooks/useLeadMeta'
import { useTemplates } from '../hooks/useTemplates'
import { extractErrorMessage } from '../utils/errors'
import {
  AUTOMATION_ACTION_LABELS as ACTION_LABELS,
  AUTOMATION_TRIGGERS as TRIGGERS,
  AutomationActionType as ActionType,
  AutomationRecipient,
  AutomationTrigger as TriggerType,
  FLOW_CONDITION_LABELS as CONDITION_LABELS,
  FLOW_NODE_LABELS,
  FlowConditionType as ConditionType,
  FlowHandle,
  FlowNodeType as NodeType,
  RESPONSE_OVERDUE_TRIGGERS,
  TASK_PRIORITY_OPTIONS,
  TASK_TYPE_OPTIONS as TASK_TYPES,
  TaskPriorityValue,
  TaskTypeValue,
  assertNever,
  isAutomationActionType,
  isAutomationTrigger,
  isFlowConditionType,
  isTaskPriority,
  isTaskType,
} from '../domain/automationCatalog'

const fieldClass = 'w-full rounded-lg border border-wa-border bg-white px-2.5 py-2 text-xs text-wa-text outline-none focus:border-wa-primary focus:ring-2 focus:ring-wa-primary/20 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark'

function defaultAction(type: AutomationActionType): AutomationAction {
  switch (type) {
    case ActionType.CreateTask:
      return { type, title: 'Dar seguimiento a {{nombre}}', description: '', task_type: TaskTypeValue.FollowUp, priority: TaskPriorityValue.Normal, due_minutes: 60, remind_minutes_before: 15, assigned_user_id: null }
    case ActionType.AssignSeller:
      return { type, user_id: null }
    case ActionType.AddTag:
    case ActionType.RemoveTag:
      return { type, tag_id: null }
    case ActionType.ChangeStage:
      return { type, stage: 'en_diagnostico' }
    case ActionType.Notify:
      return { type, recipient: AutomationRecipient.Seller, user_id: null, title: 'Seguimiento pendiente', body: 'Revisa el lead {{nombre}}.' }
    case ActionType.SendTemplate:
      return { type, template_id: null }
    default:
      return assertNever(type)
  }
}

function initialFlow(): AutomationFlowDefinition {
  return {
    conditions: {},
    nodes: [
      { id: 'trigger-1', type: NodeType.Trigger, position: { x: 70, y: 220 }, data: { trigger_type: TriggerType.LeadCreated } },
      { id: 'action-1', type: NodeType.Action, position: { x: 390, y: 220 }, data: { action: defaultAction(ActionType.CreateTask) } },
      { id: 'end-1', type: NodeType.End, position: { x: 710, y: 220 }, data: { label: 'Fin' } },
    ],
    edges: [
      { id: 'edge-trigger-1-action-1', source: 'trigger-1', target: 'action-1', source_handle: FlowHandle.Next },
      { id: 'edge-action-1-end-1', source: 'action-1', target: 'end-1', source_handle: FlowHandle.Next },
    ],
  }
}

function isFlowDefinition(value: unknown): value is AutomationFlowDefinition {
  if (!value || typeof value !== 'object') return false
  return 'nodes' in value && 'edges' in value && Array.isArray(value.nodes) && Array.isArray(value.edges)
}

function withDefaultConditions(definition: AutomationFlowDefinition): AutomationFlowDefinition {
  return { ...definition, conditions: definition.conditions ?? {} }
}

function createFlowNode(type: AutomationFlowNodeType, id: string, x: number, y: number): AutomationFlowNode {
  const position = { x, y }
  switch (type) {
    case NodeType.Trigger:
      return { id, type, position, data: { trigger_type: TriggerType.LeadCreated } }
    case NodeType.Condition:
      return { id, type, position, data: { condition_type: ConditionType.StageEquals, value: 'nuevo' } }
    case NodeType.Action:
      return { id, type, position, data: { action: defaultAction(ActionType.CreateTask) } }
    case NodeType.Wait:
      return { id, type, position, data: { minutes: 30 } }
    case NodeType.End:
      return { id, type, position, data: { label: 'Fin' } }
    default:
      return assertNever(type)
  }
}

function nodeIcon(type: AutomationFlowNodeType) {
  if (type === NodeType.Trigger) return <Zap className="h-4 w-4 text-wa-primary-strong" />
  if (type === NodeType.Condition) return <Split className="h-4 w-4 text-amber-600" />
  if (type === NodeType.Action) return <Activity className="h-4 w-4 text-violet-600" />
  if (type === NodeType.Wait) return <Clock3 className="h-4 w-4 text-blue-600" />
  return <CheckCircle2 className="h-4 w-4 text-wa-muted" />
}

function nodeTitle(node: AutomationFlowNode) {
  if (node.type === NodeType.Trigger) return TRIGGERS.find(item => item.value === node.data.trigger_type)?.label ?? 'Disparador'
  if (node.type === NodeType.Condition) return CONDITION_LABELS[node.data.condition_type]
  if (node.type === NodeType.Action) return ACTION_LABELS[node.data.action.type]
  if (node.type === NodeType.Wait) return `Esperar ${node.data.minutes} min`
  return node.data.label || 'Fin'
}

interface VisualFlowBuilderProps {
  rule?: AutomationRule
  onClose: () => void
}

export function VisualFlowBuilder({ rule, onClose }: VisualFlowBuilderProps) {
  const createFlow = useCreateVisualFlow()
  const saveFlow = useSaveVisualFlow()
  const publishFlow = usePublishVisualFlow()
  const simulateFlow = useSimulateVisualFlow()
  const updateRule = useUpdateAutomation()
  const { data: users = [] } = useUsers(true)
  const { data: tags = [] } = useTags()
  const { data: templates = [] } = useTemplates(true)
  const [ruleId, setRuleId] = useState<number | null>(rule?.id ?? null)
  const [name, setName] = useState(rule?.name ?? 'Nuevo flujo visual')
  const [maxPerHour, setMaxPerHour] = useState<number | null>(rule?.max_executions_per_hour ?? null)
  const [flow, setFlow] = useState<AutomationFlowDefinition>(() => {
    const definition = rule?.flow_definition
    return isFlowDefinition(definition) && definition.nodes.length
      ? withDefaultConditions(definition)
      : initialFlow()
  })
  const [showEntryConditions, setShowEntryConditions] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(flow.nodes[0]?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [simulationOpen, setSimulationOpen] = useState(false)
  const [leadSearch, setLeadSearch] = useState('')
  const [leadResults, setLeadResults] = useState<Chat[]>([])
  const [selectedLead, setSelectedLead] = useState<Chat | null>(null)
  const [simulation, setSimulation] = useState<AutomationFlowSimulation | null>(null)
  const [searching, setSearching] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const { data: versions = [], isLoading: versionsLoading } = useFlowVersions(versionsOpen ? ruleId : null)
  const restoreVersion = useRestoreFlowVersion()
  const selected = flow.nodes.find(node => node.id === selectedId) ?? null
  const activeUsers = users.filter(user => user.is_active)
  const automaticTemplates = useMemo(() => templates.filter(template => template.is_active && template.template_type === 'internal' && template.interactive_type === 'none'), [templates])
  const isBusy = createFlow.isPending || saveFlow.isPending || publishFlow.isPending
  const entryConditionCount = Object.values(flow.conditions).filter(value => (
    typeof value === 'boolean' ? value : value !== null && value !== undefined && value !== ''
  )).length

  function replaceNode(nextNode: AutomationFlowNode) {
    setFlow(current => ({
      ...current,
      nodes: current.nodes.map(node => node.id === nextNode.id ? nextNode : node),
    }))
  }

  function replaceSelectedAction(nextAction: AutomationAction) {
    if (!selected || selected.type !== NodeType.Action) return
    replaceNode({ ...selected, data: { action: nextAction } })
  }

  function updateEntryConditions(conditions: AutomationConditions) {
    setFlow(current => ({ ...current, conditions }))
  }

  const addNode = useCallback((type: AutomationFlowNodeType, position: { x: number; y: number }) => {
    if (type === NodeType.Trigger) {
      setError('El flujo solo puede tener un disparador.')
      return
    }
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setFlow(current => ({ ...current, nodes: [...current.nodes, createFlowNode(type, id, position.x, position.y)] }))
    setSelectedId(id)
    setError(null)
  }, [])

  const removeNode = useCallback((nodeId: string) => {
    setError(null)
    setFlow(current => {
      const node = current.nodes.find(item => item.id === nodeId)
      if (node?.type === NodeType.Trigger) {
        setError('El disparador no se puede eliminar; podés cambiar su tipo.')
        return current
      }
      return {
        ...current,
        nodes: current.nodes.filter(item => item.id !== nodeId),
        edges: current.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId),
      }
    })
    setSelectedId(previous => (previous === nodeId ? null : previous))
  }, [])

  const moveNode = useCallback((nodeId: string, position: { x: number; y: number }) => {
    setFlow(current => ({
      ...current,
      nodes: current.nodes.map(node => (node.id === nodeId ? { ...node, position } : node)),
    }))
  }, [])

  const connectNodes = useCallback((edge: AutomationFlowEdge) => {
    setError(null)
    setFlow(current => ({
      ...current,
      // Una salida solo puede apuntar a un destino: reconectar reemplaza la
      // conexión anterior de ese mismo handle en vez de sumar una segunda.
      edges: [
        ...current.edges.filter(
          item => !(item.source === edge.source && item.source_handle === edge.source_handle),
        ),
        edge,
      ],
    }))
  }, [])

  const removeEdge = useCallback((edgeId: string) => {
    setFlow(current => ({ ...current, edges: current.edges.filter(edge => edge.id !== edgeId) }))
  }, [])

  function autoLayout() {
    const trigger = flow.nodes.find(node => node.type === NodeType.Trigger)
    if (!trigger) return
    const levels = new Map<string, number>([[trigger.id, 0]])
    const queue = [trigger.id]
    while (queue.length) {
      const source = queue.shift()!
      const level = levels.get(source) ?? 0
      flow.edges.filter(edge => edge.source === source).forEach(edge => {
        if (!levels.has(edge.target)) { levels.set(edge.target, level + 1); queue.push(edge.target) }
      })
    }
    const groups = new Map<number, string[]>()
    flow.nodes.forEach(node => {
      const level = levels.get(node.id) ?? Math.max(1, levels.size)
      groups.set(level, [...(groups.get(level) ?? []), node.id])
    })
    setFlow(current => ({
      ...current,
      nodes: current.nodes.map(node => {
        const level = levels.get(node.id) ?? Math.max(1, levels.size)
        const group = groups.get(level) ?? [node.id]
        const row = group.indexOf(node.id)
        return { ...node, position: { x: 60 + level * 310, y: 100 + row * 180 } }
      }),
    }))
  }

  async function persistDraft() {
    setError(null); setNotice(null)
    try {
      const saved = ruleId == null
        ? await createFlow.mutateAsync({ name, flow_definition: flow })
        : await saveFlow.mutateAsync({ id: ruleId, name, flow_definition: flow })
      setRuleId(saved.id)
      if (isFlowDefinition(saved.flow_definition)) setFlow(withDefaultConditions(saved.flow_definition))
      setNotice('Borrador guardado.')
      return saved
    } catch (reason) {
      setError(extractErrorMessage(reason))
      return null
    }
  }

  function commitMaxPerHour(value: number | null) {
    setMaxPerHour(value)
    if (ruleId == null || value === (rule?.max_executions_per_hour ?? null)) return
    updateRule.mutate({ id: ruleId, max_executions_per_hour: value }, { onError: reason => setError(extractErrorMessage(reason)) })
  }

  async function restore(version: number) {
    if (ruleId == null) return
    setError(null); setNotice(null)
    try {
      const restored = await restoreVersion.mutateAsync({ id: ruleId, version })
      if (isFlowDefinition(restored.flow_definition)) setFlow(withDefaultConditions(restored.flow_definition))
      setName(restored.name)
      setSelectedId(null)
      setVersionsOpen(false)
      setNotice(`Versión ${version} cargada como borrador. Revísala y publica para aplicarla.`)
    } catch (reason) { setError(extractErrorMessage(reason)) }
  }

  async function publish() {
    const saved = await persistDraft()
    if (!saved) return
    try {
      const published = await publishFlow.mutateAsync(saved.id)
      setNotice(`Flujo publicado · versión ${published.flow_version}.`)
    } catch (reason) { setError(extractErrorMessage(reason)) }
  }

  async function searchLeads() {
    setSearching(true); setError(null)
    try {
      const response = await client.get<{ items: Chat[] }>('/api/chats', { params: { search: leadSearch.trim() } })
      setLeadResults(response.data.items.slice(0, 12))
    } catch (reason) { setError(extractErrorMessage(reason)) }
    finally { setSearching(false) }
  }

  async function simulate() {
    if (!selectedLead) return
    const saved = await persistDraft()
    if (!saved) return
    try {
      setSimulation(await simulateFlow.mutateAsync({ id: saved.id, leadId: selectedLead.chat_id }))
      setSimulationOpen(true)
    } catch (reason) { setError(extractErrorMessage(reason)) }
  }

  return <div className="fixed inset-0 z-[60] flex flex-col bg-wa-field dark:bg-wa-app-dark">
    <header className="flex flex-wrap items-center gap-3 border-b border-wa-border bg-white px-4 py-3 dark:border-wa-border-dark dark:bg-wa-panel-dark">
      <button type="button" onClick={onClose} className="rounded-lg p-2 text-wa-muted hover:bg-wa-field dark:hover:bg-wa-head-dark"><X className="h-5 w-5" /></button>
      <div className="min-w-[220px] flex-1"><input value={name} maxLength={120} onChange={event => setName(event.target.value)} className="w-full max-w-md border-0 bg-transparent text-base font-semibold text-wa-text outline-none dark:text-white" /><p className="text-[11px] text-wa-muted">{ruleId ? `Flujo #${ruleId}${rule?.flow_version ? ` · publicado v${rule.flow_version}` : ' · borrador'}` : 'Nuevo borrador visual'}</p></div>
      <button type="button" onClick={() => setShowEntryConditions(current => !current)} className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${showEntryConditions ? 'border-wa-primary-strong bg-green-50 text-wa-primary-strong dark:bg-green-950/30 dark:text-green-300' : 'border-wa-border text-gray-600 dark:border-wa-border-dark dark:text-gray-300'}`}><ListFilter className="h-4 w-4" />Condiciones{entryConditionCount > 0 && <span className="rounded-full bg-wa-primary px-1.5 py-0.5 text-[9px] text-white">{entryConditionCount}</span>}</button>
      <label title={ruleId == null ? 'Guarda el borrador primero' : 'Freno de seguridad: pasado el tope, el resto se reintenta más tarde'} className="flex items-center gap-1.5 rounded-lg border border-wa-border px-3 py-2 text-xs font-semibold text-gray-600 dark:border-wa-border-dark dark:text-gray-300">Máx/hora<input type="number" min={1} max={1000} disabled={ruleId == null} placeholder="∞" value={maxPerHour ?? ''} onChange={event => setMaxPerHour(event.target.value ? Number(event.target.value) : null)} onBlur={event => commitMaxPerHour(event.target.value ? Number(event.target.value) : null)} className="w-16 rounded border border-wa-border bg-white px-1.5 py-1 text-xs disabled:opacity-40 dark:border-wa-border-dark dark:bg-wa-head-dark" /></label>
      <button type="button" onClick={autoLayout} className="flex items-center gap-1.5 rounded-lg border border-wa-border px-3 py-2 text-xs font-semibold text-gray-600 dark:border-wa-border-dark dark:text-gray-300"><LayoutGrid className="h-4 w-4" />Ordenar</button>
      <button type="button" disabled={ruleId == null} title={ruleId == null ? 'Guarda el borrador primero' : 'Ver versiones publicadas'} onClick={() => setVersionsOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-wa-border px-3 py-2 text-xs font-semibold text-gray-600 disabled:opacity-40 dark:border-wa-border-dark dark:text-gray-300"><History className="h-4 w-4" />Versiones</button>
      <button type="button" onClick={() => { setSimulationOpen(true); setSimulation(null) }} className="flex items-center gap-1.5 rounded-lg border border-wa-border px-3 py-2 text-xs font-semibold text-gray-600 dark:border-wa-border-dark dark:text-gray-300"><Beaker className="h-4 w-4" />Probar</button>
      <button type="button" disabled={isBusy} onClick={() => void persistDraft()} className="flex items-center gap-1.5 rounded-lg border border-wa-primary-strong px-3 py-2 text-xs font-semibold text-wa-primary-strong disabled:opacity-40 dark:text-wa-primary"><Save className="h-4 w-4" />Guardar borrador</button>
      <button type="button" disabled={isBusy} onClick={() => void publish()} className="flex items-center gap-1.5 rounded-lg bg-wa-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Publicar</button>
    </header>

    {(error || notice) && <div className={`px-4 py-2 text-xs ${error ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-green-100 text-wa-primary-strong dark:bg-green-950 dark:text-green-300'}`}>{error ?? notice}</div>}

    <div className="flex min-h-0 flex-1">
      <aside className="w-48 shrink-0 overflow-y-auto border-r border-wa-border bg-white p-3 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-wa-muted">Arrastra al lienzo</p>
        {([
          [NodeType.Condition, FLOW_NODE_LABELS[NodeType.Condition], Split, 'Rama Sí/No'],
          [NodeType.Action, FLOW_NODE_LABELS[NodeType.Action], Activity, 'Ejecuta una operación'],
          [NodeType.Wait, FLOW_NODE_LABELS[NodeType.Wait], Clock3, 'Continúa más tarde'],
          [NodeType.End, FLOW_NODE_LABELS[NodeType.End], CheckCircle2, 'Termina esta ruta'],
        ] as Array<[AutomationFlowNodeType, string, typeof Activity, string]>).map(([type, label, Icon, description]) => <div key={type} draggable onDragStart={event => event.dataTransfer.setData('application/x-flow-palette', type)} className="mb-2 cursor-grab rounded-xl border border-wa-border bg-wa-hover p-3 active:cursor-grabbing dark:border-wa-border-dark dark:bg-wa-head-dark"><div className="flex items-center gap-2 text-xs font-semibold text-gray-800 dark:text-wa-text-dark"><Icon className="h-4 w-4 text-wa-primary-strong" />{label}</div><p className="mt-1 text-[10px] text-wa-muted">{description}</p></div>)}
        <div className="mt-4 rounded-xl bg-blue-50 p-3 text-[10px] leading-relaxed text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"><strong>Cómo conectar:</strong> arrastra desde el punto derecho de un bloque hasta el punto izquierdo del siguiente. Para borrar, selecciona la conexión y pulsa Supr.</div>
      </aside>

      <main className="min-w-0 flex-1 bg-wa-field dark:bg-wa-app-dark">
        <FlowCanvas
          flow={flow}
          selectedId={selectedId}
          onSelect={id => { setSelectedId(id); if (id) setShowEntryConditions(false) }}
          onMoveNode={moveNode}
          onDeleteNode={removeNode}
          onConnect={connectNodes}
          onDeleteEdge={removeEdge}
          onDropNewNode={addNode}
        />
      </main>

      <aside className="w-80 shrink-0 overflow-y-auto border-l border-wa-border bg-white p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        {showEntryConditions ? <EntryConditionsEditor conditions={flow.conditions} updateConditions={updateEntryConditions} users={activeUsers} tags={tags} /> : !selected ? <p className="py-16 text-center text-xs text-wa-muted">Selecciona un bloque para editarlo.</p> : <><div className="mb-4 flex items-center gap-2">{nodeIcon(selected.type)}<div><p className="text-xs font-semibold text-wa-text dark:text-white">{nodeTitle(selected)}</p><p className="text-[10px] text-wa-muted">Propiedades del bloque</p></div></div>
          {selected.type === NodeType.Trigger && <div className="space-y-3"><label className="grid gap-1 text-[10px] text-wa-muted">Evento<select value={selected.data.trigger_type} onChange={event => { const value = event.target.value; if (isAutomationTrigger(value)) replaceNode({ ...selected, data: { ...selected.data, trigger_type: value } }) }} className={fieldClass}>{TRIGGERS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{RESPONSE_OVERDUE_TRIGGERS.has(selected.data.trigger_type) && <label className="grid gap-1 text-[10px] text-wa-muted">Minutos sin respuesta<input type="number" min={1} max={43200} value={selected.data.minutes ?? 30} onChange={event => replaceNode({ ...selected, data: { ...selected.data, minutes: Number(event.target.value) } })} className={fieldClass} /></label>}</div>}
          {selected.type === NodeType.Condition && <div className="space-y-3"><label className="grid gap-1 text-[10px] text-wa-muted">Comprobar<select value={selected.data.condition_type} onChange={event => { const value = event.target.value; if (isFlowConditionType(value)) replaceNode({ ...selected, data: { condition_type: value, value: value === ConditionType.StageEquals ? 'nuevo' : null } }) }} className={fieldClass}>{Object.entries(CONDITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{selected.data.condition_type === ConditionType.StageEquals && <select value={String(selected.data.value ?? 'nuevo')} onChange={event => replaceNode({ ...selected, data: { ...selected.data, value: event.target.value } })} className={fieldClass}>{LEAD_STAGES.map(stage => <option key={stage} value={stage}>{stage}</option>)}</select>}{selected.data.condition_type === ConditionType.OriginContains && <input value={String(selected.data.value ?? '')} onChange={event => replaceNode({ ...selected, data: { ...selected.data, value: event.target.value } })} placeholder="Ej. Facebook" className={fieldClass} />}{selected.data.condition_type === ConditionType.ServiceContains && <input value={String(selected.data.value ?? '')} onChange={event => replaceNode({ ...selected, data: { ...selected.data, value: event.target.value } })} placeholder="Ej. Limpieza" className={fieldClass} />}{selected.data.condition_type === ConditionType.SellerEquals && <select value={String(selected.data.value ?? '')} onChange={event => replaceNode({ ...selected, data: { ...selected.data, value: Number(event.target.value) || null } })} className={fieldClass}><option value="">Selecciona vendedor</option>{activeUsers.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>}{selected.data.condition_type === ConditionType.TagPresent && <select value={String(selected.data.value ?? '')} onChange={event => replaceNode({ ...selected, data: { ...selected.data, value: Number(event.target.value) || null } })} className={fieldClass}><option value="">Selecciona etiqueta</option>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>}<p className="rounded-lg bg-amber-50 p-2 text-[10px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">Conecta las dos salidas: Sí cuando se cumple y No cuando no se cumple.</p></div>}
          {selected.type === NodeType.Wait && <label className="grid gap-1 text-[10px] text-wa-muted">Esperar minutos<input type="number" min={1} max={10080} value={selected.data.minutes} onChange={event => replaceNode({ ...selected, data: { minutes: Number(event.target.value) } })} className={fieldClass} /></label>}
          {selected.type === NodeType.End && <label className="grid gap-1 text-[10px] text-wa-muted">Nombre de esta salida<input maxLength={80} value={selected.data.label} onChange={event => replaceNode({ ...selected, data: { label: event.target.value } })} className={fieldClass} /></label>}
          {selected.type === NodeType.Action && <ActionEditor action={selected.data.action} updateAction={replaceSelectedAction} users={activeUsers} tags={tags} templates={automaticTemplates} />}
          <div className="mt-5 border-t border-wa-border pt-4 dark:border-wa-border-dark"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-wa-muted">Conexiones de salida</p>{flow.edges.filter(edge => edge.source === selected.id).length === 0 ? <p className="text-[10px] text-wa-muted">Sin conexiones.</p> : flow.edges.filter(edge => edge.source === selected.id).map(edge => <div key={edge.id} className="mb-1 flex items-center gap-2 rounded-lg bg-wa-hover px-2 py-1.5 text-[10px] dark:bg-wa-head-dark"><ArrowRight className="h-3 w-3" /><span className="min-w-0 flex-1 truncate">{edge.source_handle} → {nodeTitle(flow.nodes.find(node => node.id === edge.target)!)}</span><button type="button" onClick={() => removeEdge(edge.id)} className="text-red-500"><X className="h-3 w-3" /></button></div>)}</div>
        </>}
      </aside>
    </div>

    {simulationOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"><div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-wa-panel-dark"><div className="flex items-start justify-between"><div><h2 className="flex items-center gap-2 text-sm font-semibold text-wa-text dark:text-white"><Beaker className="h-4 w-4 text-wa-primary-strong" />Simular sin ejecutar acciones</h2><p className="mt-1 text-[11px] text-wa-muted">Guarda el borrador y recorre el flujo con los datos actuales de un lead.</p></div><button type="button" onClick={() => setSimulationOpen(false)} className="text-wa-muted"><X className="h-5 w-5" /></button></div><div className="mt-4 flex gap-2"><input value={leadSearch} onChange={event => setLeadSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void searchLeads() }} placeholder="Buscar por nombre o teléfono" className={fieldClass} /><button type="button" disabled={searching} onClick={() => void searchLeads()} className="rounded-lg bg-wa-head-dark px-3 text-xs font-semibold text-white disabled:opacity-40 dark:bg-wa-active-dark">Buscar</button></div>{leadResults.length > 0 && <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-wa-border dark:border-wa-border-dark">{leadResults.map(lead => <button key={lead.chat_id} type="button" onClick={() => setSelectedLead(lead)} className={`flex w-full items-center gap-2 border-b border-wa-border px-3 py-2 text-left last:border-0 dark:border-wa-border-dark ${selectedLead?.chat_id === lead.chat_id ? 'bg-green-50 dark:bg-green-950/30' : ''}`}><UserRound className="h-4 w-4 text-wa-muted" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-gray-800 dark:text-wa-text-dark">{lead.name || 'Sin nombre'}</span><span className="block text-[10px] text-wa-muted">{lead.phone || lead.chat_id} · {lead.stage}</span></span></button>)}</div>}<button type="button" disabled={!selectedLead || simulateFlow.isPending} onClick={() => void simulate()} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-wa-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{simulateFlow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Recorrer flujo</button>{simulation && <div className="mt-4"><p className="mb-2 text-xs font-semibold text-gray-800 dark:text-wa-text-dark">Ruta para {simulation.lead_name || simulation.lead_id}</p><div className="space-y-1.5">{simulation.path.map((step, index) => <div key={`${String(step.node_id)}-${index}`} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[10px] ${step.status === 'would_fail' ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300' : 'border-wa-border bg-wa-hover text-gray-600 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-gray-300'}`}><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-wa-border font-bold dark:bg-wa-active-dark">{index + 1}</span><span><strong>{String(step.type)}</strong>{step.branch ? ` · rama ${step.branch === 'yes' ? 'Sí' : 'No'}` : ''}{step.minutes ? ` · ${String(step.minutes)} min` : ''}{step.detail ? <span className="block opacity-80">{String(step.detail)}</span> : null}</span></div>)}</div></div>}</div></div>}
    {versionsOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setVersionsOpen(false) }}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-wa-panel-dark">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-wa-text dark:text-white"><History className="h-4 w-4 text-wa-primary-strong" />Versiones publicadas</h2>
            <p className="mt-1 text-[11px] text-wa-muted">Restaurar carga la versión como borrador. No cambia lo que se está ejecutando hasta que publiques.</p>
          </div>
          <button type="button" onClick={() => setVersionsOpen(false)} className="text-wa-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-4 space-y-2">
          {versionsLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-wa-muted" /></div>
            : versions.length === 0 ? <p className="py-8 text-center text-xs text-wa-muted">Este flujo todavía no se publicó ninguna vez.</p>
            : versions.map(item => (
              <div key={item.version} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${item.is_current ? 'border-wa-primary/40 bg-green-50 dark:border-green-800 dark:bg-green-950/30' : 'border-wa-border dark:border-wa-border-dark'}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-wa-text dark:text-white">Versión {item.version}{item.is_current && <span className="ml-2 rounded-full bg-wa-primary px-1.5 py-0.5 text-[9px] font-bold text-white">En uso</span>}</p>
                  <p className="text-[10px] text-wa-muted">{item.node_count} bloques · {item.edge_count} conexiones · {new Date(item.created_at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}</p>
                </div>
                <button type="button" disabled={restoreVersion.isPending} onClick={() => void restore(item.version)} className="shrink-0 rounded-lg border border-wa-border px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-wa-hover disabled:opacity-40 dark:border-wa-border-dark dark:text-gray-300 dark:hover:bg-wa-head-dark">Restaurar</button>
              </div>
            ))}
        </div>
      </div>
    </div>}
  </div>
}

interface EntryConditionsEditorProps {
  conditions: AutomationConditions
  updateConditions: (conditions: AutomationConditions) => void
  users: AppUser[]
  tags: Tag[]
}

function EntryConditionsEditor({ conditions, updateConditions, users, tags }: EntryConditionsEditorProps) {
  return <div className="space-y-4">
    <div className="flex items-start gap-2">
      <ListFilter className="mt-0.5 h-4 w-4 shrink-0 text-wa-primary-strong" />
      <div><p className="text-xs font-semibold text-wa-text dark:text-white">Condiciones de entrada</p><p className="mt-1 text-[10px] leading-relaxed text-wa-muted">Todas las condiciones configuradas deben cumplirse antes de iniciar el flujo. Para crear rutas Sí/No, utiliza un bloque Condición.</p></div>
    </div>
    <label className="grid gap-1 text-[10px] text-wa-muted">Etapa
      <select value={conditions.stage ?? ''} onChange={event => { const value = event.target.value; updateConditions({ ...conditions, stage: isLeadStage(value) ? value : null }) }} className={fieldClass}>
        <option value="">Cualquiera</option>
        {LEAD_STAGES.map(stage => <option key={stage} value={stage}>{stage}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-[10px] text-wa-muted">Origen contiene
      <input maxLength={120} value={conditions.origin_contains ?? ''} onChange={event => updateConditions({ ...conditions, origin_contains: event.target.value })} placeholder="Ej. Facebook" className={fieldClass} />
    </label>
    <label className="grid gap-1 text-[10px] text-wa-muted">Servicio contiene
      <input maxLength={120} value={conditions.service_contains ?? ''} onChange={event => updateConditions({ ...conditions, service_contains: event.target.value })} placeholder="Ej. Limpieza" className={fieldClass} />
    </label>
    <label className="grid gap-1 text-[10px] text-wa-muted">Vendedor
      <select value={conditions.seller_id ?? ''} onChange={event => updateConditions({ ...conditions, seller_id: event.target.value ? Number(event.target.value) : null })} className={fieldClass}>
        <option value="">Cualquiera</option>
        {users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-[10px] text-wa-muted">Etiqueta
      <select value={conditions.tag_id ?? ''} onChange={event => updateConditions({ ...conditions, tag_id: event.target.value ? Number(event.target.value) : null })} className={fieldClass}>
        <option value="">Cualquiera</option>
        {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
      </select>
    </label>
    <div className="space-y-2 rounded-xl border border-wa-border p-3 dark:border-wa-border-dark">
      <label className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300"><input type="checkbox" checked={!!conditions.require_open_window} onChange={event => updateConditions({ ...conditions, require_open_window: event.target.checked })} />Ventana de WhatsApp abierta</label>
      <label className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300"><input type="checkbox" checked={!!conditions.business_hours_only} onChange={event => updateConditions({ ...conditions, business_hours_only: event.target.checked })} />Horario laboral 08:00–18:00</label>
    </div>
    <label className="grid gap-1 text-[10px] text-wa-muted">No repetir para el mismo lead durante (minutos)
      <input type="number" min={1} max={43200} placeholder="Sin límite" value={conditions.cooldown_minutes ?? ''} onChange={event => updateConditions({ ...conditions, cooldown_minutes: event.target.value ? Number(event.target.value) : null })} className={fieldClass} />
      <span className="font-normal text-[10px] text-wa-muted">Evita que el flujo se repita para el mismo lead si escribe varias veces seguidas. Muy recomendable en flujos disparados por "Mensaje recibido".</span>
    </label>
    <button type="button" onClick={() => updateConditions({})} className="w-full rounded-lg border border-wa-border px-3 py-2 text-[11px] font-semibold text-wa-muted hover:bg-wa-hover dark:border-wa-border-dark dark:hover:bg-wa-head-dark">Limpiar condiciones</button>
  </div>
}

interface ActionEditorProps {
  action: AutomationAction
  updateAction: (action: AutomationAction) => void
  users: Array<{ id: number; name: string }>
  tags: Array<{ id: number; name: string }>
  templates: Array<{ id: number; name: string }>
}

function ActionEditor({ action, updateAction, users, tags, templates }: ActionEditorProps) {
  return <div className="space-y-3"><label className="grid gap-1 text-[10px] text-wa-muted">Acción<select value={action.type} onChange={event => { if (isAutomationActionType(event.target.value)) updateAction(defaultAction(event.target.value)) }} className={fieldClass}>{Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {action.type === ActionType.CreateTask && <><label className="grid gap-1 text-[10px] text-wa-muted">Título<input value={action.title} onChange={event => updateAction({ ...action, title: event.target.value })} className={fieldClass} /></label><label className="grid gap-1 text-[10px] text-wa-muted">Descripción<textarea rows={2} value={action.description ?? ''} onChange={event => updateAction({ ...action, description: event.target.value })} className={fieldClass} /></label><div className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-[10px] text-wa-muted">Tipo<select value={action.task_type} onChange={event => { const value = event.target.value; if (isTaskType(value)) updateAction({ ...action, task_type: value }) }} className={fieldClass}>{TASK_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="grid gap-1 text-[10px] text-wa-muted">Prioridad<select value={action.priority} onChange={event => { const value = event.target.value; if (isTaskPriority(value)) updateAction({ ...action, priority: value }) }} className={fieldClass}>{TASK_PRIORITY_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="grid gap-1 text-[10px] text-wa-muted">Vence en min<input type="number" min={1} max={43200} value={action.due_minutes} onChange={event => updateAction({ ...action, due_minutes: Number(event.target.value) })} className={fieldClass} /></label><label className="grid gap-1 text-[10px] text-wa-muted">Recordar antes<input type="number" min={0} value={action.remind_minutes_before} onChange={event => updateAction({ ...action, remind_minutes_before: Number(event.target.value) })} className={fieldClass} /></label></div><label className="grid gap-1 text-[10px] text-wa-muted">Responsable<select value={action.assigned_user_id ?? ''} onChange={event => updateAction({ ...action, assigned_user_id: Number(event.target.value) || null })} className={fieldClass}><option value="">Vendedor del lead</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label></>}
    {action.type === ActionType.AssignSeller && <select value={action.user_id ?? ''} onChange={event => updateAction({ ...action, user_id: Number(event.target.value) || null })} className={fieldClass}><option value="">Selecciona vendedor</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>}
    {(action.type === ActionType.AddTag || action.type === ActionType.RemoveTag) && <select value={action.tag_id ?? ''} onChange={event => updateAction({ ...action, tag_id: Number(event.target.value) || null })} className={fieldClass}><option value="">Selecciona etiqueta</option>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>}
    {action.type === ActionType.ChangeStage && <select value={action.stage} onChange={event => { const value = event.target.value; if (isLeadStage(value)) updateAction({ ...action, stage: value }) }} className={fieldClass}>{LEAD_STAGES.map(stage => <option key={stage} value={stage}>{stage}</option>)}</select>}
    {action.type === ActionType.Notify && <><select value={action.recipient} onChange={event => updateAction({ ...action, recipient: event.target.value === AutomationRecipient.Specific ? AutomationRecipient.Specific : AutomationRecipient.Seller, user_id: null })} className={fieldClass}><option value={AutomationRecipient.Seller}>Vendedor del lead</option><option value={AutomationRecipient.Specific}>Usuario específico</option></select>{action.recipient === AutomationRecipient.Specific && <select value={action.user_id ?? ''} onChange={event => updateAction({ ...action, user_id: Number(event.target.value) || null })} className={fieldClass}><option value="">Selecciona usuario</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>}<input value={action.title} onChange={event => updateAction({ ...action, title: event.target.value })} placeholder="Título" className={fieldClass} /><textarea rows={3} value={action.body} onChange={event => updateAction({ ...action, body: event.target.value })} placeholder="Contenido" className={fieldClass} /></>}
    {action.type === ActionType.SendTemplate && <><select value={action.template_id ?? ''} onChange={event => updateAction({ ...action, template_id: Number(event.target.value) || null })} className={fieldClass}><option value="">Selecciona plantilla</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select><p className="text-[10px] text-amber-600">Admite adjuntos (imagen, video, audio, documento). Requiere ventana de 24 horas abierta.</p></>}
    <div className="rounded-lg bg-wa-hover p-2 text-[10px] text-wa-muted dark:bg-wa-head-dark"><MessageSquareText className="mr-1 inline h-3 w-3" />Variables: {'{{nombre}}'}, {'{{telefono}}'}, {'{{servicio}}'}, {'{{vendedor}}'}.</div>
  </div>
}
