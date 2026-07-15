import { useMemo, useState } from 'react'
import {
  Activity, ArrowRight, Beaker, CheckCircle2, Clock3, GripVertical, LayoutGrid,
  Loader2, MessageSquareText, Play, Save, Split, Trash2, UserRound, X, Zap,
} from 'lucide-react'
import client from '../api/client'
import type {
  AutomationAction, AutomationActionType, AutomationFlowConditionType,
  AutomationFlowDefinition, AutomationFlowEdge, AutomationFlowNode,
  AutomationFlowNodeType, AutomationRule, AutomationTrigger, Chat, LeadStage,
  TaskPriority, TaskType,
} from '../types'
import { LEAD_STAGES } from '../types'
import {
  useCreateVisualFlow, usePublishVisualFlow, useSaveVisualFlow,
  useSimulateVisualFlow, type AutomationFlowSimulation,
} from '../hooks/useAutomations'
import { useUsers } from '../hooks/useUsers'
import { useTags } from '../hooks/useLeadMeta'
import { useTemplates } from '../hooks/useTemplates'
import { extractErrorMessage } from '../utils/errors'

const TRIGGERS: Array<{ value: AutomationTrigger; label: string }> = [
  { value: 'lead_created', label: 'Lead nuevo' },
  { value: 'stage_changed', label: 'Cambio de etapa' },
  { value: 'message_received', label: 'Mensaje recibido' },
  { value: 'seller_response_overdue', label: 'Vendedor sin responder' },
  { value: 'customer_response_overdue', label: 'Cliente sin responder' },
  { value: 'task_due', label: 'Tarea vencida' },
]

const ACTION_LABELS: Record<AutomationActionType, string> = {
  create_task: 'Crear tarea', assign_seller: 'Asignar vendedor', add_tag: 'Agregar etiqueta',
  remove_tag: 'Quitar etiqueta', change_stage: 'Cambiar etapa', notify: 'Notificar internamente',
  send_template: 'Enviar plantilla WhatsApp',
}

const CONDITION_LABELS: Record<AutomationFlowConditionType, string> = {
  stage_equals: 'Etapa es', origin_contains: 'Origen contiene', service_contains: 'Servicio contiene',
  seller_equals: 'Vendedor es', tag_present: 'Tiene etiqueta',
  whatsapp_window_open: 'Ventana WhatsApp abierta', business_hours: 'Está en horario laboral',
}

const TASK_TYPES: Array<{ value: TaskType; label: string }> = [
  { value: 'whatsapp', label: 'WhatsApp' }, { value: 'llamada', label: 'Llamada' },
  { value: 'cotizacion', label: 'Cotización' }, { value: 'cita', label: 'Cita' },
  { value: 'seguimiento', label: 'Seguimiento' }, { value: 'otro', label: 'Otro' },
]

const NODE_WIDTH = 220
const NODE_HEIGHT = 112
const CANVAS_WIDTH = 1900
const CANVAS_HEIGHT = 1100
const fieldClass = 'w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-900 outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'

function defaultAction(type: AutomationActionType): AutomationAction {
  if (type === 'create_task') return { type, title: 'Dar seguimiento a {{nombre}}', description: '', task_type: 'seguimiento', priority: 'normal', due_minutes: 60, remind_minutes_before: 15, assigned_user_id: null }
  if (type === 'assign_seller') return { type, user_id: null }
  if (type === 'add_tag' || type === 'remove_tag') return { type, tag_id: undefined }
  if (type === 'change_stage') return { type, stage: 'calificacion' }
  if (type === 'notify') return { type, recipient: 'seller', user_id: null, title: 'Seguimiento pendiente', body: 'Revisa el lead {{nombre}}.' }
  return { type, template_id: undefined }
}

function initialFlow(): AutomationFlowDefinition {
  return {
    nodes: [
      { id: 'trigger-1', type: 'trigger', position: { x: 70, y: 220 }, data: { trigger_type: 'lead_created' } },
      { id: 'action-1', type: 'action', position: { x: 390, y: 220 }, data: { action: defaultAction('create_task') } },
      { id: 'end-1', type: 'end', position: { x: 710, y: 220 }, data: { label: 'Fin' } },
    ],
    edges: [
      { id: 'edge-trigger-1-action-1', source: 'trigger-1', target: 'action-1', source_handle: 'next' },
      { id: 'edge-action-1-end-1', source: 'action-1', target: 'end-1', source_handle: 'next' },
    ],
  }
}

function isFlowDefinition(value: unknown): value is AutomationFlowDefinition {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AutomationFlowDefinition>
  return Array.isArray(candidate.nodes) && Array.isArray(candidate.edges)
}

function nodeData(type: AutomationFlowNodeType): AutomationFlowNode['data'] {
  if (type === 'condition') return { condition_type: 'stage_equals', value: 'nuevo' }
  if (type === 'action') return { action: defaultAction('create_task') }
  if (type === 'wait') return { minutes: 30 }
  if (type === 'end') return { label: 'Fin' }
  return { trigger_type: 'lead_created' }
}

function nodeTone(type: AutomationFlowNodeType) {
  if (type === 'trigger') return 'border-green-400 bg-green-50 dark:border-green-800 dark:bg-green-950/30'
  if (type === 'condition') return 'border-amber-400 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
  if (type === 'action') return 'border-violet-400 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30'
  if (type === 'wait') return 'border-blue-400 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30'
  return 'border-gray-400 bg-gray-50 dark:border-gray-700 dark:bg-gray-800'
}

function nodeIcon(type: AutomationFlowNodeType) {
  if (type === 'trigger') return <Zap className="h-4 w-4 text-green-600" />
  if (type === 'condition') return <Split className="h-4 w-4 text-amber-600" />
  if (type === 'action') return <Activity className="h-4 w-4 text-violet-600" />
  if (type === 'wait') return <Clock3 className="h-4 w-4 text-blue-600" />
  return <CheckCircle2 className="h-4 w-4 text-gray-500" />
}

function nodeTitle(node: AutomationFlowNode) {
  if (node.type === 'trigger') return TRIGGERS.find(item => item.value === node.data.trigger_type)?.label ?? 'Disparador'
  if (node.type === 'condition') return CONDITION_LABELS[node.data.condition_type ?? 'stage_equals']
  if (node.type === 'action') return ACTION_LABELS[node.data.action?.type ?? 'create_task']
  if (node.type === 'wait') return `Esperar ${node.data.minutes ?? 0} min`
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
  const { data: users = [] } = useUsers(true)
  const { data: tags = [] } = useTags()
  const { data: templates = [] } = useTemplates(true)
  const [ruleId, setRuleId] = useState<number | null>(rule?.id ?? null)
  const [name, setName] = useState(rule?.name ?? 'Nuevo flujo visual')
  const [flow, setFlow] = useState<AutomationFlowDefinition>(() => {
    const definition = rule?.flow_definition
    return isFlowDefinition(definition) && definition.nodes.length ? definition : initialFlow()
  })
  const [selectedId, setSelectedId] = useState<string | null>(flow.nodes[0]?.id ?? null)
  const [connecting, setConnecting] = useState<{ source: string; handle: 'next' | 'yes' | 'no' } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [simulationOpen, setSimulationOpen] = useState(false)
  const [leadSearch, setLeadSearch] = useState('')
  const [leadResults, setLeadResults] = useState<Chat[]>([])
  const [selectedLead, setSelectedLead] = useState<Chat | null>(null)
  const [simulation, setSimulation] = useState<AutomationFlowSimulation | null>(null)
  const [searching, setSearching] = useState(false)
  const selected = flow.nodes.find(node => node.id === selectedId) ?? null
  const activeUsers = users.filter(user => user.is_active)
  const automaticTemplates = useMemo(() => templates.filter(template => template.is_active && template.template_type === 'internal' && template.interactive_type === 'none' && template.attachments.length === 0), [templates])
  const isBusy = createFlow.isPending || saveFlow.isPending || publishFlow.isPending

  function updateNode(nodeId: string, patch: Partial<AutomationFlowNode['data']>) {
    setFlow(current => ({
      ...current,
      nodes: current.nodes.map(node => node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node),
    }))
  }

  function updateAction(patch: Partial<AutomationAction>) {
    if (!selected || selected.type !== 'action') return
    updateNode(selected.id, { action: { ...selected.data.action, ...patch } as AutomationAction })
  }

  function addNode(type: AutomationFlowNodeType, x: number, y: number) {
    if (type === 'trigger' && flow.nodes.some(node => node.type === 'trigger')) {
      setError('El flujo solo puede tener un disparador.')
      return
    }
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const node: AutomationFlowNode = {
      id, type,
      position: { x: Math.max(10, Math.min(CANVAS_WIDTH - NODE_WIDTH - 10, x)), y: Math.max(10, Math.min(CANVAS_HEIGHT - NODE_HEIGHT - 10, y)) },
      data: nodeData(type),
    }
    setFlow(current => ({ ...current, nodes: [...current.nodes, node] }))
    setSelectedId(id)
    setError(null)
  }

  function removeNode(nodeId: string) {
    const node = flow.nodes.find(item => item.id === nodeId)
    if (node?.type === 'trigger') { setError('El disparador no se puede eliminar; puedes cambiar su tipo.'); return }
    setFlow(current => ({
      nodes: current.nodes.filter(item => item.id !== nodeId),
      edges: current.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId),
    }))
    setSelectedId(flow.nodes.find(item => item.id !== nodeId)?.id ?? null)
  }

  function connectTo(target: string) {
    if (!connecting || connecting.source === target) return
    const targetNode = flow.nodes.find(node => node.id === target)
    if (!targetNode || targetNode.type === 'trigger') { setError('El disparador no puede recibir conexiones.'); return }
    const edge: AutomationFlowEdge = {
      id: `edge-${connecting.source}-${connecting.handle}-${target}-${Date.now()}`,
      source: connecting.source, target, source_handle: connecting.handle,
    }
    setFlow(current => ({
      ...current,
      edges: [...current.edges.filter(item => !(item.source === connecting.source && item.source_handle === connecting.handle)), edge],
    }))
    setConnecting(null)
    setError(null)
  }

  function removeEdge(edgeId: string) {
    setFlow(current => ({ ...current, edges: current.edges.filter(edge => edge.id !== edgeId) }))
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left - NODE_WIDTH / 2
    const y = event.clientY - rect.top - 24
    const paletteType = event.dataTransfer.getData('application/x-flow-palette') as AutomationFlowNodeType
    const movingId = event.dataTransfer.getData('application/x-flow-node')
    if (paletteType) { addNode(paletteType, x, y); return }
    if (movingId) {
      setFlow(current => ({
        ...current,
        nodes: current.nodes.map(node => node.id === movingId ? {
          ...node,
          position: { x: Math.max(10, Math.min(CANVAS_WIDTH - NODE_WIDTH - 10, x)), y: Math.max(10, Math.min(CANVAS_HEIGHT - NODE_HEIGHT - 10, y)) },
        } : node),
      }))
    }
  }

  function autoLayout() {
    const trigger = flow.nodes.find(node => node.type === 'trigger')
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
      if (isFlowDefinition(saved.flow_definition)) setFlow(saved.flow_definition)
      setNotice('Borrador guardado.')
      return saved
    } catch (reason) {
      setError(extractErrorMessage(reason))
      return null
    }
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

  return <div className="fixed inset-0 z-[60] flex flex-col bg-gray-100 dark:bg-gray-950">
    <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
      <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
      <div className="min-w-[220px] flex-1"><input value={name} maxLength={120} onChange={event => setName(event.target.value)} className="w-full max-w-md border-0 bg-transparent text-base font-semibold text-gray-900 outline-none dark:text-white" /><p className="text-[11px] text-gray-500">{ruleId ? `Flujo #${ruleId}${rule?.flow_version ? ` · publicado v${rule.flow_version}` : ' · borrador'}` : 'Nuevo borrador visual'}</p></div>
      <button type="button" onClick={autoLayout} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 dark:border-gray-700 dark:text-gray-300"><LayoutGrid className="h-4 w-4" />Ordenar</button>
      <button type="button" onClick={() => { setSimulationOpen(true); setSimulation(null) }} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 dark:border-gray-700 dark:text-gray-300"><Beaker className="h-4 w-4" />Probar</button>
      <button type="button" disabled={isBusy} onClick={() => void persistDraft()} className="flex items-center gap-1.5 rounded-lg border border-green-600 px-3 py-2 text-xs font-semibold text-green-700 disabled:opacity-40 dark:text-green-400"><Save className="h-4 w-4" />Guardar borrador</button>
      <button type="button" disabled={isBusy} onClick={() => void publish()} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Publicar</button>
    </header>

    {(error || notice || connecting) && <div className={`flex items-center justify-between px-4 py-2 text-xs ${error ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : connecting ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'}`}><span>{error ?? (connecting ? 'Ahora selecciona el bloque de destino.' : notice)}</span>{connecting && <button type="button" onClick={() => setConnecting(null)} className="font-semibold">Cancelar conexión</button>}</div>}

    <div className="flex min-h-0 flex-1">
      <aside className="w-48 shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">Arrastra al lienzo</p>
        {([
          ['condition', 'Condición', Split, 'Rama Sí/No'], ['action', 'Acción', Activity, 'Ejecuta una operación'],
          ['wait', 'Espera', Clock3, 'Continúa más tarde'], ['end', 'Fin', CheckCircle2, 'Termina esta ruta'],
        ] as Array<[AutomationFlowNodeType, string, typeof Activity, string]>).map(([type, label, Icon, description]) => <div key={type} draggable onDragStart={event => event.dataTransfer.setData('application/x-flow-palette', type)} className="mb-2 cursor-grab rounded-xl border border-gray-200 bg-gray-50 p-3 active:cursor-grabbing dark:border-gray-700 dark:bg-gray-800"><div className="flex items-center gap-2 text-xs font-semibold text-gray-800 dark:text-gray-100"><Icon className="h-4 w-4 text-green-600" />{label}</div><p className="mt-1 text-[10px] text-gray-500">{description}</p></div>)}
        <div className="mt-4 rounded-xl bg-blue-50 p-3 text-[10px] leading-relaxed text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"><strong>Cómo conectar:</strong> pulsa una salida del bloque y después “Conectar aquí” en el destino.</div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto bg-gray-100 dark:bg-gray-950">
        <div onDragOver={event => event.preventDefault()} onDrop={handleDrop} className="relative" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, backgroundImage: 'radial-gradient(circle, rgb(148 163 184 / .35) 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
            <defs><marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#94a3b8" /></marker></defs>
            {flow.edges.map(edge => {
              const source = flow.nodes.find(node => node.id === edge.source)
              const target = flow.nodes.find(node => node.id === edge.target)
              if (!source || !target) return null
              const sx = source.position.x + NODE_WIDTH; const sy = source.position.y + NODE_HEIGHT / 2
              const tx = target.position.x; const ty = target.position.y + NODE_HEIGHT / 2
              const bend = Math.max(60, Math.abs(tx - sx) * .45)
              return <g key={edge.id}><path d={`M${sx},${sy} C${sx + bend},${sy} ${tx - bend},${ty} ${tx},${ty}`} fill="none" stroke={edge.source_handle === 'yes' ? '#22c55e' : edge.source_handle === 'no' ? '#ef4444' : '#94a3b8'} strokeWidth="2" markerEnd="url(#flow-arrow)" /><text x={(sx + tx) / 2} y={(sy + ty) / 2 - 7} textAnchor="middle" className="fill-gray-500 text-[10px]">{edge.source_handle === 'yes' ? 'Sí' : edge.source_handle === 'no' ? 'No' : ''}</text></g>
            })}
          </svg>
          {flow.nodes.map(node => <div key={node.id} onClick={() => { setSelectedId(node.id); if (connecting) connectTo(node.id) }} className={`absolute rounded-xl border-2 p-3 shadow-md transition ${nodeTone(node.type)} ${selectedId === node.id ? 'ring-2 ring-green-500 ring-offset-2 dark:ring-offset-gray-950' : ''}`} style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT, left: node.position.x, top: node.position.y }}>
            {connecting && node.type !== 'trigger' && connecting.source !== node.id && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-green-600 px-2 py-0.5 text-[9px] font-bold text-white shadow">Conectar aquí</span>}
            <div className="flex items-start gap-2"><button type="button" draggable onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('application/x-flow-node', node.id) }} className="cursor-grab rounded p-0.5 text-gray-400 active:cursor-grabbing"><GripVertical className="h-4 w-4" /></button>{nodeIcon(node.type)}<div className="min-w-0 flex-1"><p className="text-[9px] font-bold uppercase tracking-wide text-gray-400">{node.type === 'trigger' ? 'Disparador' : node.type === 'condition' ? 'Condición' : node.type === 'action' ? 'Acción' : node.type === 'wait' ? 'Espera' : 'Fin'}</p><p className="truncate text-xs font-semibold text-gray-800 dark:text-gray-100">{nodeTitle(node)}</p></div>{node.type !== 'trigger' && <button type="button" onClick={event => { event.stopPropagation(); removeNode(node.id) }} className="text-gray-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>}</div>
            {node.type !== 'end' && <div className="mt-3 flex justify-end gap-1">{node.type === 'condition' ? <><button type="button" onClick={event => { event.stopPropagation(); setConnecting({ source: node.id, handle: 'yes' }) }} className="rounded-full bg-green-600 px-2 py-1 text-[9px] font-bold text-white">Sí →</button><button type="button" onClick={event => { event.stopPropagation(); setConnecting({ source: node.id, handle: 'no' }) }} className="rounded-full bg-red-500 px-2 py-1 text-[9px] font-bold text-white">No →</button></> : <button type="button" onClick={event => { event.stopPropagation(); setConnecting({ source: node.id, handle: 'next' }) }} className="rounded-full bg-gray-700 px-2 py-1 text-[9px] font-bold text-white dark:bg-gray-600">Siguiente →</button>}</div>}
          </div>)}
        </div>
      </main>

      <aside className="w-80 shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        {!selected ? <p className="py-16 text-center text-xs text-gray-500">Selecciona un bloque para editarlo.</p> : <><div className="mb-4 flex items-center gap-2">{nodeIcon(selected.type)}<div><p className="text-xs font-semibold text-gray-900 dark:text-white">{nodeTitle(selected)}</p><p className="text-[10px] text-gray-500">Propiedades del bloque</p></div></div>
          {selected.type === 'trigger' && <div className="space-y-3"><label className="grid gap-1 text-[10px] text-gray-500">Evento<select value={selected.data.trigger_type} onChange={event => updateNode(selected.id, { trigger_type: event.target.value as AutomationTrigger })} className={fieldClass}>{TRIGGERS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{['seller_response_overdue', 'customer_response_overdue'].includes(selected.data.trigger_type ?? '') && <label className="grid gap-1 text-[10px] text-gray-500">Minutos sin respuesta<input type="number" min={1} max={43200} value={selected.data.minutes ?? 30} onChange={event => updateNode(selected.id, { minutes: Number(event.target.value) })} className={fieldClass} /></label>}</div>}
          {selected.type === 'condition' && <div className="space-y-3"><label className="grid gap-1 text-[10px] text-gray-500">Comprobar<select value={selected.data.condition_type} onChange={event => updateNode(selected.id, { condition_type: event.target.value as AutomationFlowConditionType, value: event.target.value === 'stage_equals' ? 'nuevo' : null })} className={fieldClass}>{Object.entries(CONDITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{selected.data.condition_type === 'stage_equals' && <select value={String(selected.data.value ?? 'nuevo')} onChange={event => updateNode(selected.id, { value: event.target.value })} className={fieldClass}>{LEAD_STAGES.map(stage => <option key={stage} value={stage}>{stage}</option>)}</select>}{selected.data.condition_type === 'origin_contains' && <input value={String(selected.data.value ?? '')} onChange={event => updateNode(selected.id, { value: event.target.value })} placeholder="Ej. Facebook" className={fieldClass} />}{selected.data.condition_type === 'service_contains' && <input value={String(selected.data.value ?? '')} onChange={event => updateNode(selected.id, { value: event.target.value })} placeholder="Ej. Limpieza" className={fieldClass} />}{selected.data.condition_type === 'seller_equals' && <select value={String(selected.data.value ?? '')} onChange={event => updateNode(selected.id, { value: Number(event.target.value) || null })} className={fieldClass}><option value="">Selecciona vendedor</option>{activeUsers.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>}{selected.data.condition_type === 'tag_present' && <select value={String(selected.data.value ?? '')} onChange={event => updateNode(selected.id, { value: Number(event.target.value) || null })} className={fieldClass}><option value="">Selecciona etiqueta</option>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>}<p className="rounded-lg bg-amber-50 p-2 text-[10px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">Conecta las dos salidas: Sí cuando se cumple y No cuando no se cumple.</p></div>}
          {selected.type === 'wait' && <label className="grid gap-1 text-[10px] text-gray-500">Esperar minutos<input type="number" min={1} max={10080} value={selected.data.minutes ?? 30} onChange={event => updateNode(selected.id, { minutes: Number(event.target.value) })} className={fieldClass} /></label>}
          {selected.type === 'end' && <label className="grid gap-1 text-[10px] text-gray-500">Nombre de esta salida<input maxLength={80} value={selected.data.label ?? 'Fin'} onChange={event => updateNode(selected.id, { label: event.target.value })} className={fieldClass} /></label>}
          {selected.type === 'action' && selected.data.action && <ActionEditor action={selected.data.action} updateAction={updateAction} users={activeUsers} tags={tags} templates={automaticTemplates} />}
          <div className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">Conexiones de salida</p>{flow.edges.filter(edge => edge.source === selected.id).length === 0 ? <p className="text-[10px] text-gray-500">Sin conexiones.</p> : flow.edges.filter(edge => edge.source === selected.id).map(edge => <div key={edge.id} className="mb-1 flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5 text-[10px] dark:bg-gray-800"><ArrowRight className="h-3 w-3" /><span className="min-w-0 flex-1 truncate">{edge.source_handle} → {nodeTitle(flow.nodes.find(node => node.id === edge.target)!)}</span><button type="button" onClick={() => removeEdge(edge.id)} className="text-red-500"><X className="h-3 w-3" /></button></div>)}</div>
        </>}
      </aside>
    </div>

    {simulationOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"><div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900"><div className="flex items-start justify-between"><div><h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"><Beaker className="h-4 w-4 text-green-600" />Simular sin ejecutar acciones</h2><p className="mt-1 text-[11px] text-gray-500">Guarda el borrador y recorre el flujo con los datos actuales de un lead.</p></div><button type="button" onClick={() => setSimulationOpen(false)} className="text-gray-400"><X className="h-5 w-5" /></button></div><div className="mt-4 flex gap-2"><input value={leadSearch} onChange={event => setLeadSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void searchLeads() }} placeholder="Buscar por nombre o teléfono" className={fieldClass} /><button type="button" disabled={searching} onClick={() => void searchLeads()} className="rounded-lg bg-gray-800 px-3 text-xs font-semibold text-white disabled:opacity-40 dark:bg-gray-700">Buscar</button></div>{leadResults.length > 0 && <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700">{leadResults.map(lead => <button key={lead.chat_id} type="button" onClick={() => setSelectedLead(lead)} className={`flex w-full items-center gap-2 border-b border-gray-100 px-3 py-2 text-left last:border-0 dark:border-gray-800 ${selectedLead?.chat_id === lead.chat_id ? 'bg-green-50 dark:bg-green-950/30' : ''}`}><UserRound className="h-4 w-4 text-gray-400" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-gray-800 dark:text-gray-100">{lead.name || 'Sin nombre'}</span><span className="block text-[10px] text-gray-500">{lead.phone || lead.chat_id} · {lead.stage}</span></span></button>)}</div>}<button type="button" disabled={!selectedLead || simulateFlow.isPending} onClick={() => void simulate()} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{simulateFlow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Recorrer flujo</button>{simulation && <div className="mt-4"><p className="mb-2 text-xs font-semibold text-gray-800 dark:text-gray-100">Ruta para {simulation.lead_name || simulation.lead_id}</p><div className="space-y-1.5">{simulation.path.map((step, index) => <div key={`${String(step.node_id)}-${index}`} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[10px] ${step.status === 'would_fail' ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300' : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-200 font-bold dark:bg-gray-700">{index + 1}</span><span><strong>{String(step.type)}</strong>{step.branch ? ` · rama ${step.branch === 'yes' ? 'Sí' : 'No'}` : ''}{step.minutes ? ` · ${String(step.minutes)} min` : ''}{step.detail ? <span className="block opacity-80">{String(step.detail)}</span> : null}</span></div>)}</div></div>}</div></div>}
  </div>
}

interface ActionEditorProps {
  action: AutomationAction
  updateAction: (patch: Partial<AutomationAction>) => void
  users: Array<{ id: number; name: string }>
  tags: Array<{ id: number; name: string }>
  templates: Array<{ id: number; name: string }>
}

function ActionEditor({ action, updateAction, users, tags, templates }: ActionEditorProps) {
  return <div className="space-y-3"><label className="grid gap-1 text-[10px] text-gray-500">Acción<select value={action.type} onChange={event => updateAction(defaultAction(event.target.value as AutomationActionType))} className={fieldClass}>{Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {action.type === 'create_task' && <><label className="grid gap-1 text-[10px] text-gray-500">Título<input value={action.title ?? ''} onChange={event => updateAction({ title: event.target.value })} className={fieldClass} /></label><label className="grid gap-1 text-[10px] text-gray-500">Descripción<textarea rows={2} value={action.description ?? ''} onChange={event => updateAction({ description: event.target.value })} className={fieldClass} /></label><div className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-[10px] text-gray-500">Tipo<select value={action.task_type} onChange={event => updateAction({ task_type: event.target.value as TaskType })} className={fieldClass}>{TASK_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="grid gap-1 text-[10px] text-gray-500">Prioridad<select value={action.priority} onChange={event => updateAction({ priority: event.target.value as TaskPriority })} className={fieldClass}><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option></select></label><label className="grid gap-1 text-[10px] text-gray-500">Vence en min<input type="number" min={1} max={43200} value={action.due_minutes} onChange={event => updateAction({ due_minutes: Number(event.target.value) })} className={fieldClass} /></label><label className="grid gap-1 text-[10px] text-gray-500">Recordar antes<input type="number" min={0} value={action.remind_minutes_before} onChange={event => updateAction({ remind_minutes_before: Number(event.target.value) })} className={fieldClass} /></label></div><label className="grid gap-1 text-[10px] text-gray-500">Responsable<select value={action.assigned_user_id ?? ''} onChange={event => updateAction({ assigned_user_id: Number(event.target.value) || null })} className={fieldClass}><option value="">Vendedor del lead</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label></>}
    {action.type === 'assign_seller' && <select value={action.user_id ?? ''} onChange={event => updateAction({ user_id: Number(event.target.value) || null })} className={fieldClass}><option value="">Selecciona vendedor</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>}
    {(action.type === 'add_tag' || action.type === 'remove_tag') && <select value={action.tag_id ?? ''} onChange={event => updateAction({ tag_id: Number(event.target.value) || undefined })} className={fieldClass}><option value="">Selecciona etiqueta</option>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>}
    {action.type === 'change_stage' && <select value={action.stage} onChange={event => updateAction({ stage: event.target.value as LeadStage })} className={fieldClass}>{LEAD_STAGES.map(stage => <option key={stage} value={stage}>{stage}</option>)}</select>}
    {action.type === 'notify' && <><select value={action.recipient} onChange={event => updateAction({ recipient: event.target.value as 'seller' | 'specific', user_id: null })} className={fieldClass}><option value="seller">Vendedor del lead</option><option value="specific">Usuario específico</option></select>{action.recipient === 'specific' && <select value={action.user_id ?? ''} onChange={event => updateAction({ user_id: Number(event.target.value) || null })} className={fieldClass}><option value="">Selecciona usuario</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>}<input value={action.title ?? ''} onChange={event => updateAction({ title: event.target.value })} placeholder="Título" className={fieldClass} /><textarea rows={3} value={action.body ?? ''} onChange={event => updateAction({ body: event.target.value })} placeholder="Contenido" className={fieldClass} /></>}
    {action.type === 'send_template' && <><select value={action.template_id ?? ''} onChange={event => updateAction({ template_id: Number(event.target.value) || undefined })} className={fieldClass}><option value="">Selecciona plantilla</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select><p className="text-[10px] text-amber-600">Solo plantillas internas de texto y con ventana de 24 horas abierta.</p></>}
    <div className="rounded-lg bg-gray-50 p-2 text-[10px] text-gray-500 dark:bg-gray-800"><MessageSquareText className="mr-1 inline h-3 w-3" />Variables: {'{{nombre}}'}, {'{{telefono}}'}, {'{{servicio}}'}, {'{{vendedor}}'}.</div>
  </div>
}
