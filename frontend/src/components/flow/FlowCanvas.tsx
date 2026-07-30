import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyNodeChanges,
  Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider,
  useReactFlow, type Connection, type Edge, type Node, type NodeProps, type NodeTypes,
  type OnConnect, type OnNodesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Activity, Bell, CheckCircle2, ChevronRight, CirclePlay, FileText,
  Image as ImageIcon, MessageCircleQuestion, MessageSquareText, Paperclip,
  Split, Tag, Timer, Trash2, UserRound, Video, Zap,
} from 'lucide-react'
import type {
  AutomationAction, AutomationFlowDefinition, AutomationFlowEdge, AutomationFlowNode,
  AutomationFlowNodeType, MediaAsset, MessageTemplate, QuestionButton, WaitAnyCondition,
} from '../../types'
import {
  AUTOMATION_ACTION_LABELS, AUTOMATION_TRIGGERS, AutomationActionType, FLOW_CONDITION_LABELS, FLOW_NODE_LABELS,
  FlowHandle, FlowNodeType, formatWaitDuration, isAutomationActionType, isFlowConditionType,
  QuestionHandle, WaitAnyConditionKind, WAIT_ANY_CONDITION_LABELS,
} from '../../domain/automationCatalog'
import { resolveMediaUrl } from '../../utils/message'

/** Datos del bloque tal como los guarda el backend, más lo que el lienzo
 *  necesita para dibujarlo (borrar, resaltar el seleccionado). */
type CanvasNodeData = Record<string, unknown> & {
  onDelete?: (id: string) => void
  isSelected?: boolean
  previewTemplate?: MessageTemplate
  previewAsset?: MediaAsset
}

type CanvasNode = Node<CanvasNodeData>

const HANDLE_STYLE = { width: 10, height: 10, background: '#64748b', border: '2px solid #fff' }

function nodeTitle(type: AutomationFlowNodeType, data: CanvasNodeData): string {
  if (type === FlowNodeType.Trigger) {
    return AUTOMATION_TRIGGERS.find(item => item.value === data.trigger_type)?.label ?? 'Disparador'
  }
  if (type === FlowNodeType.Condition) {
    const condition = String(data.condition_type ?? '')
    return isFlowConditionType(condition) ? FLOW_CONDITION_LABELS[condition] : 'Condición'
  }
  if (type === FlowNodeType.Action) {
    const action = data.action as { type?: string } | undefined
    const actionType = String(action?.type ?? '')
    return isAutomationActionType(actionType) ? AUTOMATION_ACTION_LABELS[actionType] : 'Acción'
  }
  if (type === FlowNodeType.Wait) return `Esperar ${formatWaitDuration(Number(data.seconds ?? 0))}`
  if (type === FlowNodeType.WaitAny) {
    const conditions = (data.conditions as WaitAnyCondition[] | undefined) ?? []
    const timer = conditions.find(c => c.kind === WaitAnyConditionKind.Timer)
    const hasMessage = conditions.some(c => c.kind === WaitAnyConditionKind.Message)
    const timerLabel = timer ? formatWaitDuration(timer.seconds) : ''
    return hasMessage ? `${timerLabel} o mensaje` : timerLabel
  }
  if (type === FlowNodeType.Question) {
    const buttons = (data.buttons as QuestionButton[] | undefined) ?? []
    return buttons.length ? buttons.map(button => button.label).join(' / ') : 'Sin botones'
  }
  return String(data.label || 'Fin')
}

function nodeKindLabel(type: AutomationFlowNodeType, data: CanvasNodeData): string {
  if (type === FlowNodeType.Question) return 'Mensaje interactivo'
  if (type === FlowNodeType.Wait || type === FlowNodeType.WaitAny) return 'Pausa'
  if (type !== FlowNodeType.Action) return FLOW_NODE_LABELS[type]
  const action = data.action as AutomationAction | undefined
  return action?.type === AutomationActionType.SendMessage
    || action?.type === AutomationActionType.SendTemplate
    || action?.type === AutomationActionType.SendAudio
    || action?.type === AutomationActionType.SendAttachment
    ? 'Mensaje'
    : 'Acción'
}

const TONES: Record<AutomationFlowNodeType, string> = {
  [FlowNodeType.Trigger]: 'border-wa-primary bg-green-50 dark:border-emerald-700 dark:bg-[#102737]',
  [FlowNodeType.Condition]: 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-[#102737]',
  [FlowNodeType.Action]: 'border-violet-400 bg-violet-50 dark:border-sky-800 dark:bg-[#102737]',
  [FlowNodeType.Wait]: 'border-cyan-400 bg-cyan-50 dark:border-cyan-800 dark:bg-[#102737]',
  [FlowNodeType.WaitAny]: 'border-cyan-400 bg-cyan-50 dark:border-cyan-800 dark:bg-[#102737]',
  [FlowNodeType.Question]: 'border-pink-400 bg-pink-50 dark:border-sky-800 dark:bg-[#102737]',
  [FlowNodeType.End]: 'border-gray-400 bg-wa-hover dark:border-slate-600 dark:bg-[#102737]',
}

const ICONS: Record<AutomationFlowNodeType, typeof Zap> = {
  [FlowNodeType.Trigger]: Zap,
  [FlowNodeType.Condition]: Split,
  [FlowNodeType.Action]: Activity,
  [FlowNodeType.Wait]: Timer,
  [FlowNodeType.WaitAny]: Timer,
  [FlowNodeType.Question]: MessageCircleQuestion,
  [FlowNodeType.End]: CheckCircle2,
}

interface ShellProps {
  id: string
  type: AutomationFlowNodeType
  data: CanvasNodeData
  selected?: boolean
  children?: React.ReactNode
}

function NodeShell({ id, type, data, selected, children }: ShellProps) {
  const Icon = ICONS[type]
  return (
    <div
      className={`w-72 rounded-xl border-2 px-3 py-2.5 shadow-sm transition-shadow ${TONES[type]} ${
        selected ? 'ring-2 ring-wa-primary ring-offset-2 dark:ring-offset-gray-950' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-600 dark:text-gray-300" />
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-wide text-wa-muted dark:text-slate-400">{nodeKindLabel(type, data)}</p>
          <p className="truncate text-xs font-semibold text-gray-800 dark:text-wa-text-dark">{nodeTitle(type, data)}</p>
        </div>
        {type !== FlowNodeType.Trigger && data.onDelete && (
          <button
            type="button"
            title="Eliminar bloque"
            onClick={event => { event.stopPropagation(); data.onDelete?.(id) }}
            className="nodrag text-wa-muted hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

function ActionPreview({ data }: { data: CanvasNodeData }) {
  const action = data.action as AutomationAction | undefined
  if (!action) return null

  if (action.type === AutomationActionType.SendMessage) {
    return <MessageCard text={action.text} empty="Escribe el mensaje en las propiedades" />
  }

  if (action.type === AutomationActionType.SendTemplate) {
    const template = data.previewTemplate
    return <div className="mt-2 overflow-hidden rounded-lg border border-violet-200 bg-white/80 dark:border-violet-800 dark:bg-gray-950/30">
      {template?.attachments[0] && <AttachmentMedia attachment={template.attachments[0]} />}
      <div className="p-2">
        <div className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300">
          <MessageSquareText className="h-3 w-3" />{template?.name ?? 'Plantilla sin seleccionar'}
        </div>
        <p className="line-clamp-4 whitespace-pre-wrap text-[10px] leading-relaxed text-gray-700 dark:text-gray-200">
          {template?.content || 'Selecciona una plantilla para ver su contenido.'}
        </p>
      </div>
    </div>
  }

  if (action.type === AutomationActionType.SendAudio) {
    const asset = data.previewAsset
    const url = asset ? resolveMediaUrl(asset.media_url) : null
    return <div className="nodrag nowheel mt-2 rounded-lg border border-violet-200 bg-white/80 p-2 dark:border-violet-800 dark:bg-gray-950/30" onClick={event => event.stopPropagation()}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-gray-600 dark:text-gray-300">
        <CirclePlay className="h-3.5 w-3.5 text-violet-600" /><span className="truncate">{asset?.filename ?? 'Audio sin seleccionar'}</span>
      </div>
      {url ? <audio src={url} controls preload="metadata" className="h-8 w-full" /> : <EmptyPreview label="Elige un audio en las propiedades" />}
    </div>
  }

  if (action.type === AutomationActionType.SendAttachment) {
    return <div className="nodrag nowheel mt-2" onClick={event => event.stopPropagation()}>
      {data.previewAsset ? <AttachmentMedia attachment={data.previewAsset} interactive /> : <EmptyPreview label="Elige un archivo para previsualizarlo" />}
    </div>
  }

  if (action.type === AutomationActionType.Notify) {
    return <div className="mt-2 rounded-lg border border-violet-200 bg-white/80 p-2 dark:border-violet-800 dark:bg-gray-950/30">
      <p className="flex items-center gap-1 text-[10px] font-semibold text-gray-800 dark:text-white"><Bell className="h-3 w-3 text-violet-600" />{action.title || 'Notificación'}</p>
      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[9px] leading-relaxed text-gray-600 dark:text-gray-300">{action.body || 'Sin contenido'}</p>
    </div>
  }

  if (action.type === AutomationActionType.CreateTask) {
    return <div className="mt-2 rounded-lg border border-violet-200 bg-white/80 p-2 text-[9px] dark:border-violet-800 dark:bg-gray-950/30">
      <p className="font-semibold text-gray-800 dark:text-white">{action.title || 'Nueva tarea'}</p>
      {action.description && <p className="mt-0.5 line-clamp-2 text-gray-500 dark:text-gray-400">{action.description}</p>}
      <div className="mt-1.5 flex items-center justify-between text-gray-500 dark:text-gray-400"><span>Vence en {formatWaitDuration(action.due_minutes * 60)}</span><span className="capitalize">{action.priority}</span></div>
    </div>
  }

  const detail = action.type === AutomationActionType.ChangeStage ? action.stage
    : action.type === AutomationActionType.ChangeService ? (action.service || 'Quitar servicio')
    : action.type === AutomationActionType.AssignSeller ? (action.user_id ? `Usuario #${action.user_id}` : 'Vendedor del lead')
    : action.type === AutomationActionType.AddTag || action.type === AutomationActionType.RemoveTag ? (action.tag_id ? `Etiqueta #${action.tag_id}` : 'Sin etiqueta')
    : null
  const DetailIcon = action.type === AutomationActionType.AssignSeller ? UserRound
    : action.type === AutomationActionType.AddTag || action.type === AutomationActionType.RemoveTag ? Tag
    : ChevronRight
  return detail ? <div className="mt-2 flex items-center gap-2 rounded-lg border border-violet-200 bg-white/80 px-2 py-2 text-[10px] font-semibold text-gray-700 dark:border-violet-800 dark:bg-gray-950/30 dark:text-gray-200">
    <DetailIcon className="h-3.5 w-3.5 text-violet-600" /><span className="truncate">{detail}</span>
  </div> : null
}

function MessageCard({ text, empty }: { text: string; empty: string }) {
  return <div className="mt-2 rounded-lg border border-violet-200 bg-white/80 p-2 dark:border-[#2a5374] dark:bg-[#173b59]">
    <p className={`line-clamp-5 whitespace-pre-wrap text-[10px] leading-relaxed ${text ? 'text-gray-700 dark:text-gray-200' : 'italic text-gray-400'}`}>{text || empty}</p>
  </div>
}

function EmptyPreview({ label }: { label: string }) {
  return <div className="rounded-lg border border-dashed border-gray-300 px-2 py-3 text-center text-[9px] text-gray-400 dark:border-gray-700">{label}</div>
}

type PreviewAttachment = Pick<MediaAsset, 'media_url' | 'content_type' | 'filename'>

function AttachmentMedia({ attachment, interactive = false }: { attachment: PreviewAttachment; interactive?: boolean }) {
  const url = resolveMediaUrl(attachment.media_url) ?? ''
  if (attachment.content_type.startsWith('image/')) {
    const image = <img src={url} alt={attachment.filename} loading="lazy" className="h-32 w-full object-cover" />
    return interactive ? <a href={url} target="_blank" rel="noreferrer" title="Abrir imagen" className="block overflow-hidden rounded-lg border border-violet-200 dark:border-violet-800">{image}<AttachmentCaption icon={ImageIcon} filename={attachment.filename} /></a> : image
  }
  if (attachment.content_type.startsWith('video/')) {
    return <div className="overflow-hidden rounded-lg border border-violet-200 bg-black dark:border-violet-800"><video src={url} controls={interactive} preload="metadata" className="h-32 w-full object-contain" />{interactive && <AttachmentCaption icon={Video} filename={attachment.filename} />}</div>
  }
  if (attachment.content_type.startsWith('audio/')) {
    return <div className="rounded-lg border border-violet-200 bg-white/80 p-2 dark:border-violet-800 dark:bg-gray-950/30"><AttachmentCaption icon={CirclePlay} filename={attachment.filename} />{interactive && <audio src={url} controls preload="metadata" className="mt-1 h-8 w-full" />}</div>
  }
  return <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-violet-200 bg-white/80 p-2 text-[10px] text-gray-700 dark:border-violet-800 dark:bg-gray-950/30 dark:text-gray-200">
    <FileText className="h-5 w-5 shrink-0 text-violet-600" /><span className="min-w-0 flex-1 truncate">{attachment.filename || 'Documento'}</span><Paperclip className="h-3 w-3" />
  </a>
}

function AttachmentCaption({ icon: Icon, filename }: { icon: typeof ImageIcon; filename: string }) {
  return <span className="flex items-center gap-1 bg-white/90 px-2 py-1 text-[9px] text-gray-600 dark:bg-gray-950/90 dark:text-gray-300"><Icon className="h-3 w-3" /><span className="truncate">{filename}</span></span>
}

const TriggerNode = memo(({ id, data, selected }: NodeProps<CanvasNode>) => (
  <NodeShell id={id} type={FlowNodeType.Trigger} data={data} selected={selected}>
    <Handle type="source" position={Position.Right} id={FlowHandle.Next} style={HANDLE_STYLE} />
  </NodeShell>
))

const ActionNode = memo(({ id, data, selected }: NodeProps<CanvasNode>) => (
  <NodeShell id={id} type={FlowNodeType.Action} data={data} selected={selected}>
    <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
    <ActionPreview data={data} />
    <Handle type="source" position={Position.Right} id={FlowHandle.Next} style={HANDLE_STYLE} />
  </NodeShell>
))

const EndNode = memo(({ id, data, selected }: NodeProps<CanvasNode>) => (
  <NodeShell id={id} type={FlowNodeType.End} data={data} selected={selected}>
    <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
  </NodeShell>
))

/** La condición expone dos salidas separadas y etiquetadas: arrastrar desde la
 *  verde crea la rama Sí y desde la roja la rama No, sin menús intermedios. */
const ConditionNode = memo(({ id, data, selected }: NodeProps<CanvasNode>) => (
  <NodeShell id={id} type={FlowNodeType.Condition} data={data} selected={selected}>
    <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
    <div className="mt-2 space-y-1">
      <div className="relative rounded-md border border-green-200 bg-white/70 px-2 py-1.5 text-[9px] font-bold text-wa-primary-strong dark:border-emerald-800 dark:bg-[#173b59] dark:text-wa-primary">
        Sí, se cumple
        <Handle type="source" position={Position.Right} id={FlowHandle.Yes} style={{ ...HANDLE_STYLE, background: '#00a884', right: -18, top: '50%' }} />
      </div>
      <div className="relative rounded-md border border-red-200 bg-white/70 px-2 py-1.5 text-[9px] font-bold text-red-500 dark:border-red-900 dark:bg-[#173b59] dark:text-red-400">
        No se cumple
        <Handle type="source" position={Position.Right} id={FlowHandle.No} style={{ ...HANDLE_STYLE, background: '#ef4444', right: -18, top: '50%' }} />
      </div>
    </div>
  </NodeShell>
))

const WAIT_ANY_HANDLE_COLORS: Record<string, string> = {
  [WaitAnyConditionKind.Timer]: '#0891b2',
  [WaitAnyConditionKind.Message]: '#7c3aed',
  [WaitAnyConditionKind.BusinessHours]: '#f59e0b',
  [WaitAnyConditionKind.MediaPlayed]: '#db2777',
}

/** Una fila por condición, cada una con su propia salida — el "id" de cada
 *  condición (== su "kind": "timer"/"message"/"business_hours"/
 *  "media_played") es el handle. */
function PauseNodeView({ id, data, selected, legacy = false }: NodeProps<CanvasNode> & { legacy?: boolean }) {
  const storedConditions = (data.conditions as WaitAnyCondition[] | undefined) ?? []
  const conditions = legacy
    ? [{ id: FlowHandle.Next, kind: WaitAnyConditionKind.Timer, seconds: Number(data.seconds ?? 0) }]
    : storedConditions
  return (
    <NodeShell id={id} type={FlowNodeType.WaitAny} data={data} selected={selected}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <div className="mt-2 space-y-1.5">
        {conditions.map(condition => (
          <div key={condition.id} className="relative flex items-center rounded-md border border-cyan-200 bg-white/70 px-2 py-1.5 text-[9px] font-semibold text-gray-600 dark:border-sky-900 dark:bg-[#173b59] dark:text-gray-200">
            <span>{condition.kind === WaitAnyConditionKind.Timer ? `Timer: ${formatWaitDuration(condition.seconds)}` : WAIT_ANY_CONDITION_LABELS[condition.kind]}</span>
            <Handle
              type="source" position={Position.Right} id={condition.id}
              style={{ ...HANDLE_STYLE, background: WAIT_ANY_HANDLE_COLORS[condition.kind], right: -18, top: '50%' }}
            />
          </div>
        ))}
      </div>
    </NodeShell>
  )
}

// Los dos identificadores se mantienen en React Flow para poder abrir un
// borrador legado sin fallar, pero ambos usan una sola vista y comportamiento.
const PauseNode = memo((props: NodeProps<CanvasNode>) => <PauseNodeView {...props} />)
const LegacyPauseNode = memo((props: NodeProps<CanvasNode>) => <PauseNodeView {...props} legacy />)

/** Una fila por botón + "Otra respuesta" + "Sin respuesta" (timeout), cada
 *  una con su propia salida — mismo patrón visual que WaitAnyNode. */
const QuestionNode = memo(({ id, data, selected }: NodeProps<CanvasNode>) => {
  const buttons = (data.buttons as QuestionButton[] | undefined) ?? []
  const rows: Array<{ handle: string; label: string; color: string }> = [
    ...buttons.map((button, index) => ({ handle: button.id, label: button.label, color: BUTTON_COLORS[index % BUTTON_COLORS.length] })),
    { handle: QuestionHandle.Other, label: 'Otra respuesta', color: '#6b7280' },
    { handle: QuestionHandle.Timeout, label: 'Sin respuesta', color: '#ef4444' },
  ]
  return (
    <NodeShell id={id} type={FlowNodeType.Question} data={data} selected={selected}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <MessageCard text={String(data.text ?? '')} empty="Escribe la pregunta en las propiedades" />
      <div className="mt-2 space-y-1">
        {rows.map(row => (
          <div key={row.handle} className="relative flex items-center gap-1.5 rounded-md border border-pink-200 bg-white/70 px-2 py-1.5 text-[9px] font-semibold text-gray-600 dark:border-sky-900 dark:bg-[#173b59] dark:text-gray-200">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: row.color }} /><span className="truncate">{row.label || 'Opción sin texto'}</span>
            <Handle type="source" position={Position.Right} id={row.handle} style={{ ...HANDLE_STYLE, background: row.color, right: -18, top: '50%' }} />
          </div>
        ))}
      </div>
    </NodeShell>
  )
})

// Fuera del componente: React Flow re-monta todos los nodos si esta referencia
// cambia entre renders.
const NODE_TYPES: NodeTypes = {
  [FlowNodeType.Trigger]: TriggerNode,
  [FlowNodeType.Condition]: ConditionNode,
  [FlowNodeType.Action]: ActionNode,
  [FlowNodeType.Wait]: LegacyPauseNode,
  [FlowNodeType.WaitAny]: PauseNode,
  [FlowNodeType.Question]: QuestionNode,
  [FlowNodeType.End]: EndNode,
}

const BUTTON_COLORS = ['#00a884', '#0891b2', '#7c3aed']

const EDGE_COLORS: Record<string, string> = {
  [FlowHandle.Yes]: '#00a884',
  [FlowHandle.No]: '#ef4444',
  [FlowHandle.Next]: '#94a3b8',
  [WaitAnyConditionKind.Timer]: '#0891b2',
  [WaitAnyConditionKind.Message]: '#7c3aed',
  [WaitAnyConditionKind.BusinessHours]: '#f59e0b',
  [WaitAnyConditionKind.MediaPlayed]: '#db2777',
  [QuestionHandle.Other]: '#6b7280',
  [QuestionHandle.Timeout]: '#ef4444',
}

const EDGE_LABELS: Record<string, string> = {
  [FlowHandle.Yes]: 'Sí',
  [FlowHandle.No]: 'No',
  [WaitAnyConditionKind.Timer]: 'Timer',
  [WaitAnyConditionKind.Message]: WAIT_ANY_CONDITION_LABELS[WaitAnyConditionKind.Message],
  [WaitAnyConditionKind.BusinessHours]: WAIT_ANY_CONDITION_LABELS[WaitAnyConditionKind.BusinessHours],
  [WaitAnyConditionKind.MediaPlayed]: WAIT_ANY_CONDITION_LABELS[WaitAnyConditionKind.MediaPlayed],
  [QuestionHandle.Other]: 'Otra respuesta',
  [QuestionHandle.Timeout]: 'Sin respuesta',
}

export function toCanvasEdges(edges: AutomationFlowEdge[]): Edge[] {
  return edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.source_handle,
    label: EDGE_LABELS[edge.source_handle],
    animated: true,
    type: 'smoothstep',
    style: { stroke: EDGE_COLORS[edge.source_handle] ?? '#94a3b8', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS[edge.source_handle] ?? '#94a3b8' },
  }))
}

export function fromCanvasEdge(edge: Edge | Connection, id: string): AutomationFlowEdge {
  // El handle siempre sale de uno de nuestros propios <Handle id=...> (Sí/No,
  // el "kind" de una condición de Pausa, o "btn_N"/"other"/"timeout" de una
  // Pregunta) — nunca de una entrada de usuario, así que alcanza con
  // aceptarlo tal cual llega y solo usar "next" cuando el nodo no tiene un
  // handle nombrado (un único source, como Trigger/Acción/Espera).
  const handle = edge.sourceHandle
  return {
    id,
    source: edge.source,
    target: edge.target,
    source_handle: (typeof handle === 'string' && handle ? handle : FlowHandle.Next) as AutomationFlowEdge['source_handle'],
  }
}

interface FlowCanvasProps {
  flow: AutomationFlowDefinition
  templates?: MessageTemplate[]
  mediaAssets?: MediaAsset[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onMoveNode: (id: string, position: { x: number; y: number }) => void
  onDeleteNode: (id: string) => void
  onConnect: (edge: AutomationFlowEdge) => void
  onDeleteEdge: (id: string) => void
  onDropNewNode: (type: AutomationFlowNodeType, position: { x: number; y: number }) => void
}

function Canvas({
  flow, templates = [], mediaAssets = [], selectedId, onSelect, onMoveNode, onDeleteNode, onConnect, onDeleteEdge, onDropNewNode,
}: FlowCanvasProps) {
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()

  const derivedNodes = useMemo<CanvasNode[]>(() => flow.nodes.map(node => {
    const nodeData = node.data as Record<string, unknown>
    const action = node.type === FlowNodeType.Action ? node.data.action : null
    const previewTemplate = action?.type === AutomationActionType.SendTemplate
      ? templates.find(template => template.id === action.template_id)
      : undefined
    const previewAsset = action?.type === AutomationActionType.SendAudio || action?.type === AutomationActionType.SendAttachment
      ? mediaAssets.find(asset => asset.id === action.media_asset_id)
      : undefined
    return {
      id: node.id,
      type: node.type,
      position: node.position,
      selected: node.id === selectedId,
      data: { ...nodeData, previewTemplate, previewAsset, onDelete: onDeleteNode },
    }
  }), [flow.nodes, templates, mediaAssets, selectedId, onDeleteNode])

  // Estado local para que el arrastre se vea moverse en vivo: `flow.nodes`
  // (la prop) solo se actualiza al soltar (ver más abajo), así que si
  // ReactFlow dependiera directo de `derivedNodes` el nodo no se movería
  // hasta ese momento. Se resincroniza cada vez que cambia lo que viene del
  // padre (agregar/borrar bloque, publicar, etc.) — eso nunca pasa a mitad
  // de un arrastre porque durante el arrastre no se llama a onMoveNode.
  const [nodes, setNodes] = useState<CanvasNode[]>(derivedNodes)
  useEffect(() => { setNodes(derivedNodes) }, [derivedNodes])

  const edges = useMemo(() => toCanvasEdges(flow.edges), [flow.edges])

  const handleNodesChange = useCallback<OnNodesChange<CanvasNode>>(changes => {
    setNodes(current => applyNodeChanges(changes, current))
    for (const change of changes) {
      if (change.type === 'position' && change.position && !change.dragging) {
        // Solo al soltar: persistir en cada frame del arrastre dispararía un
        // render del builder entero por cada píxel movido.
        onMoveNode(change.id, {
          x: Math.round(change.position.x),
          y: Math.round(change.position.y),
        })
      }
      if (change.type === 'remove') onDeleteNode(change.id)
    }
  }, [onMoveNode, onDeleteNode])

  const handleConnect = useCallback<OnConnect>(connection => {
    const handle = connection.sourceHandle ?? FlowHandle.Next
    onConnect(fromCanvasEdge(connection, `edge-${connection.source}-${handle}-${connection.target}-${Date.now()}`))
  }, [onConnect])

  /** El disparador arranca el flujo: no puede recibir conexiones, y un bloque
   *  no puede conectarse consigo mismo. */
  const isValidConnection = useCallback((connection: Edge | Connection) => {
    if (connection.source === connection.target) return false
    const target = flow.nodes.find(node => node.id === connection.target)
    return target?.type !== FlowNodeType.Trigger
  }, [flow.nodes])

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    const raw = event.dataTransfer.getData('application/x-flow-palette')
    if (!raw) return
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    onDropNewNode(raw as AutomationFlowNodeType, {
      x: Math.max(0, Math.round(position.x)),
      y: Math.max(0, Math.round(position.y)),
    })
  }, [screenToFlowPosition, onDropNewNode])

  return (
    <div ref={wrapper} className="h-full w-full">
      <ReactFlow
        className="bg-wa-field dark:bg-[#0d2230]"
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        onEdgesChange={changes => changes.forEach(change => {
          if (change.type === 'remove') onDeleteEdge(change.id)
        })}
        onConnect={handleConnect}
        isValidConnection={isValidConnection}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
        onDrop={handleDrop}
        colorMode="system"
        fitView
        proOptions={{ hideAttribution: false }}
        deleteKeyCode={['Backspace', 'Delete']}
        defaultEdgeOptions={{ animated: true, type: 'smoothstep' }}
        minZoom={0.2}
      >
        <Background gap={22} size={1} className="opacity-60" />
        <Controls position="top-right" orientation="horizontal" showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-white dark:!bg-wa-panel-dark" />
      </ReactFlow>
    </div>
  )
}

export function FlowCanvas(props: FlowCanvasProps) {
  // useReactFlow (para screenToFlowPosition) exige estar dentro del provider.
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}

export type { AutomationFlowNode }
