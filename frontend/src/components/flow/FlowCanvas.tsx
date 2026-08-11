import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyNodeChanges,
  Background, BaseEdge, ControlButton, Controls, EdgeToolbar, Handle, MiniMap, PanOnScrollMode, Position, ReactFlow, ReactFlowProvider, SelectionMode,
  getSmoothStepPath,
  useReactFlow, type Connection, type Edge, type Node, type NodeProps, type NodeTypes,
  type EdgeProps, type EdgeTypes, type OnConnect, type OnNodesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Activity, Bell, CheckCircle2, ChevronRight, CirclePlay, FileText,
  Image as ImageIcon, MessageCircleQuestion, MessageSquareText, Paperclip,
  Eye, EyeOff, Repeat, SmilePlus, Split, Tag, Timer, Trash2, UserRound, Video, Zap,
} from 'lucide-react'
import type {
  AutomationAction, AutomationFlowConditionGroup, AutomationFlowConditionType, AutomationFlowDefinition, AutomationFlowEdge, AutomationFlowNode,
  AutomationFlowNodeType, AutomationRule, AutomationTrigger, MediaAsset, MessageTemplate, QuestionButton, RoundRobinOutput, WaitAnyCondition,
} from '../../types'
import {
  AUTOMATION_ACTION_LABELS, AUTOMATION_TRIGGERS, AutomationActionType, FLOW_CONDITION_LABELS, FLOW_NODE_LABELS,
  FlowHandle, FlowNodeType, formatWaitDuration, isAutomationActionType, isFlowConditionType,
  QuestionHandle, WaitAnyConditionKind, WAIT_ANY_CONDITION_LABELS,
} from '../../domain/automationCatalog'
import { resolveMediaUrl } from '../../utils/message'
import { fromCanvasEdge, toCanvasEdges } from './flowCanvasEdges'

/** Datos del bloque tal como los guarda el backend, más lo que el lienzo
 *  necesita para dibujarlo (borrar, resaltar el seleccionado). */
type CanvasNodeDataValue =
  | string | number | boolean | null | undefined
  | AutomationAction | AutomationFlowConditionGroup[] | WaitAnyCondition[] | QuestionButton[] | RoundRobinOutput[]
  | MessageTemplate | MediaAsset
  | ((id: string) => void)

interface CanvasNodeData {
  [key: string]: CanvasNodeDataValue
  trigger_type?: AutomationTrigger
  condition_type?: AutomationFlowConditionType
  value?: string | number | boolean | null
  condition_groups?: AutomationFlowConditionGroup[]
  action?: AutomationAction
  flow_rule_id?: number | null
  invokedFlowName?: string
  seconds?: number
  conditions?: WaitAnyCondition[]
  text?: string
  buttons?: QuestionButton[]
  outputs?: RoundRobinOutput[]
  timeout_seconds?: number
  label?: string
  close_conversation?: boolean
  onDelete?: (id: string) => void
  isSelected?: boolean
  previewTemplate?: MessageTemplate
  previewAsset?: MediaAsset
  connectionRole?: 'source' | 'target' | 'both'
  connectionDimmed?: boolean
}

type CanvasNode = Node<CanvasNodeData>

const HANDLE_STYLE = { width: 10, height: 10, background: '#64748b', border: '2px solid #fff' }
const CONNECTION_HIGHLIGHT_STORAGE_KEY = 'automation-flow:highlight-connections'
const EMPTY_TEMPLATES: MessageTemplate[] = []
const EMPTY_MEDIA_ASSETS: MediaAsset[] = []
const EMPTY_FLOW_RULES: AutomationRule[] = []

function storedConnectionHighlightPreference(): boolean {
  try {
    return window.localStorage.getItem(CONNECTION_HIGHLIGHT_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function nodeTitle(type: AutomationFlowNodeType, data: CanvasNodeData): string {
  if (type === FlowNodeType.Trigger) {
    return AUTOMATION_TRIGGERS.find(item => item.value === data.trigger_type)?.label ?? 'Disparador'
  }
  if (type === FlowNodeType.Condition) {
    const first = data.condition_groups?.[0]?.conditions[0]
    const condition = String(first?.condition_type ?? data.condition_type ?? '')
    const count = data.condition_groups?.reduce((sum, group) => sum + group.conditions.length, 0) ?? 1
    const label = isFlowConditionType(condition) ? FLOW_CONDITION_LABELS[condition] : 'Condición'
    return `${label}${count > 1 ? ` (+${count - 1})` : ''}`
  }
  if (type === FlowNodeType.Action) {
    const action = data.action
    const actionType = String(action?.type ?? '')
    return isAutomationActionType(actionType) ? AUTOMATION_ACTION_LABELS[actionType] : 'Acción'
  }
  if (type === FlowNodeType.InvokeFlow) return data.invokedFlowName ?? 'Selecciona un flujo'
  if (type === FlowNodeType.Wait) return `Esperar ${formatWaitDuration(Number(data.seconds ?? 0))}`
  if (type === FlowNodeType.WaitAny) {
    const conditions = data.conditions ?? []
    const timer = conditions.find(c => c.kind === WaitAnyConditionKind.Timer)
    const hasMessage = conditions.some(c => c.kind === WaitAnyConditionKind.Message)
    const timerLabel = timer ? formatWaitDuration(timer.seconds) : ''
    return hasMessage ? `${timerLabel} o mensaje` : timerLabel
  }
  if (type === FlowNodeType.Question) {
    const buttons = data.buttons ?? []
    return buttons.length ? buttons.map(button => button.label).join(' / ') : 'Sin botones'
  }
  if (type === FlowNodeType.RoundRobin) {
    const outputs = data.outputs ?? []
    return outputs.length ? `Reparto entre ${outputs.length} salidas` : 'Sin salidas'
  }
  return String(data.label || 'Fin')
}

function nodeKindLabel(type: AutomationFlowNodeType, data: CanvasNodeData): string {
  if (type === FlowNodeType.Question) return 'Mensaje interactivo'
  if (type === FlowNodeType.RoundRobin) return 'Reparto por turnos'
  if (type === FlowNodeType.InvokeFlow) return 'Flujo hijo'
  if (type === FlowNodeType.Wait || type === FlowNodeType.WaitAny) return 'Pausa'
  if (type !== FlowNodeType.Action) return FLOW_NODE_LABELS[type]
  const action = data.action
  if (action?.type === AutomationActionType.ReactToLastCustomerMessage) return 'Reacción'
  return action?.type === AutomationActionType.SendMessage
    || action?.type === AutomationActionType.SendTemplate
    || action?.type === AutomationActionType.SendAudio
    || action?.type === AutomationActionType.SendAttachment
    || action?.type === AutomationActionType.SendMedia
    ? 'Mensaje'
    : 'Acción'
}

const TONES: Record<AutomationFlowNodeType, string> = {
  [FlowNodeType.Trigger]: 'border-wa-primary bg-green-50 dark:border-emerald-700 dark:bg-[#102737]',
  [FlowNodeType.Condition]: 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-[#102737]',
  [FlowNodeType.Action]: 'border-violet-400 bg-violet-50 dark:border-sky-800 dark:bg-[#102737]',
  [FlowNodeType.InvokeFlow]: 'border-indigo-400 bg-indigo-50 dark:border-indigo-800 dark:bg-[#102737]',
  [FlowNodeType.Wait]: 'border-cyan-400 bg-cyan-50 dark:border-cyan-800 dark:bg-[#102737]',
  [FlowNodeType.WaitAny]: 'border-cyan-400 bg-cyan-50 dark:border-cyan-800 dark:bg-[#102737]',
  [FlowNodeType.Question]: 'border-pink-400 bg-pink-50 dark:border-sky-800 dark:bg-[#102737]',
  [FlowNodeType.RoundRobin]: 'border-teal-400 bg-teal-50 dark:border-teal-800 dark:bg-[#102737]',
  [FlowNodeType.End]: 'border-gray-400 bg-wa-hover dark:border-slate-600 dark:bg-[#102737]',
}

const ICONS: Record<AutomationFlowNodeType, typeof Zap> = {
  [FlowNodeType.Trigger]: Zap,
  [FlowNodeType.Condition]: Split,
  [FlowNodeType.Action]: Activity,
  [FlowNodeType.InvokeFlow]: CirclePlay,
  [FlowNodeType.Wait]: Timer,
  [FlowNodeType.WaitAny]: Timer,
  [FlowNodeType.Question]: MessageCircleQuestion,
  [FlowNodeType.RoundRobin]: Repeat,
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
  const widthClass = type === FlowNodeType.Condition ? 'w-[26rem]' : 'w-72'
  const connectionClass = data.connectionRole === 'source'
    ? 'ring-2 ring-cyan-400 ring-offset-2 shadow-[0_0_24px_rgba(34,211,238,0.45)] dark:ring-offset-gray-950'
    : data.connectionRole === 'target'
      ? 'ring-2 ring-violet-500 ring-offset-2 shadow-[0_0_24px_rgba(139,92,246,0.5)] dark:ring-offset-gray-950'
      : data.connectionRole === 'both'
        ? 'ring-2 ring-fuchsia-500 ring-offset-2 shadow-[0_0_24px_rgba(217,70,239,0.45)] dark:ring-offset-gray-950'
        : selected
          ? 'ring-2 ring-wa-primary ring-offset-2 dark:ring-offset-gray-950'
          : ''
  const connectionLabel = data.connectionRole === 'source'
    ? 'Origen'
    : data.connectionRole === 'target'
      ? 'Destino'
      : data.connectionRole === 'both'
        ? 'Conectado'
        : null
  return (
    <div
      className={`relative ${widthClass} rounded-xl border-2 px-3 py-2.5 shadow-sm transition-[opacity,filter,box-shadow] duration-200 ${TONES[type]} ${connectionClass} ${
        data.connectionDimmed ? 'opacity-40 saturate-50' : ''
      }`}
    >
      {connectionLabel && <span className={`absolute -top-3 left-3 z-20 rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white shadow-sm ${
        data.connectionRole === 'source' ? 'bg-cyan-600' : data.connectionRole === 'target' ? 'bg-violet-600' : 'bg-fuchsia-600'
      }`}>{connectionLabel}</span>}
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
  const action = data.action
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

  if (action.type === AutomationActionType.SendMedia) {
    return <div className="nodrag nowheel mt-2 overflow-hidden rounded-lg border border-violet-200 bg-white/80 dark:border-violet-800 dark:bg-gray-950/30" onClick={event => event.stopPropagation()}>
      {data.previewAsset ? <AttachmentMedia attachment={data.previewAsset} interactive /> : <EmptyPreview label="Elige un archivo para previsualizarlo" />}
      <p className={`whitespace-pre-wrap px-2 py-1.5 text-[10px] leading-relaxed ${action.caption ? 'text-gray-700 dark:text-gray-200' : 'italic text-gray-400'}`}>{action.caption || 'Sin caption'}</p>
    </div>
  }

  if (action.type === AutomationActionType.Notify) {
    return <div className="mt-2 rounded-lg border border-violet-200 bg-white/80 p-2 dark:border-violet-800 dark:bg-gray-950/30">
      <p className="flex items-center gap-1 text-[10px] font-semibold text-gray-800 dark:text-white"><Bell className="h-3 w-3 text-violet-600" />{action.title || 'Notificación'}</p>
      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[9px] leading-relaxed text-gray-600 dark:text-gray-300">{action.body || 'Sin contenido'}</p>
    </div>
  }

  if (action.type === AutomationActionType.ReactToLastCustomerMessage) {
    return <div className="mt-2 flex items-center gap-2 rounded-lg border border-violet-200 bg-white/80 p-2 dark:border-violet-800 dark:bg-gray-950/30">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-lg dark:bg-violet-950">{action.emoji || '🙂'}</span>
      <div className="min-w-0">
        <p className="flex items-center gap-1 text-[10px] font-semibold text-gray-800 dark:text-white"><SmilePlus className="h-3 w-3 text-violet-600" />Último mensaje del cliente</p>
        <p className="truncate text-[9px] text-gray-500 dark:text-gray-400">Enviar reacción {action.emoji || 'sin seleccionar'}</p>
      </div>
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

const InvokeFlowNode = memo(({ id, data, selected }: NodeProps<CanvasNode>) => (
  <NodeShell id={id} type={FlowNodeType.InvokeFlow} data={data} selected={selected}>
    <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
    <div className="mt-2 rounded-lg border border-indigo-200 bg-white/80 p-2 text-[10px] text-indigo-700 dark:border-indigo-800 dark:bg-gray-950/30 dark:text-indigo-300">
      Inicia una ejecución independiente para el mismo lead
    </div>
    <Handle type="source" position={Position.Right} id={FlowHandle.Next} style={HANDLE_STYLE} />
  </NodeShell>
))

const EndNode = memo(({ id, data, selected }: NodeProps<CanvasNode>) => (
  <NodeShell id={id} type={FlowNodeType.End} data={data} selected={selected}>
    <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
    {data.close_conversation && <div className="mt-2 rounded-md border border-gray-200 bg-white/70 px-2 py-1.5 text-[9px] font-semibold text-gray-600 dark:border-slate-700 dark:bg-gray-950/30 dark:text-gray-300">Cierra la conversación</div>}
  </NodeShell>
))

/** Una salida verde por grupo OR y una roja cuando ninguno coincide. */
const ConditionNode = memo(({ id, data, selected }: NodeProps<CanvasNode>) => {
  const groups = data.condition_groups?.length ? data.condition_groups : [{
    id: FlowHandle.Yes,
    conditions: [{
      id: 'legacy-condition',
      condition_type: data.condition_type ?? ('stage_equals' as AutomationFlowConditionType),
      value: data.value ?? null,
    }],
  }]
  return <NodeShell id={id} type={FlowNodeType.Condition} data={data} selected={selected}>
    <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
    <div className="mt-2 space-y-1">
      {groups.map((group, groupIndex) => <div key={group.id}>
        {groupIndex > 0 && <div className="py-0.5 text-center text-[8px] font-bold uppercase text-amber-600">O</div>}
        <div className="relative rounded-md border border-green-200 bg-white/70 px-2 py-1.5 text-[9px] text-gray-700 dark:border-emerald-800 dark:bg-[#173b59] dark:text-gray-200">
          {group.conditions.map((condition, conditionIndex) => <div key={condition.id} className="leading-snug">
            {conditionIndex > 0 && <span className="mr-1 font-bold text-wa-primary-strong">Y</span>}
            <span className="font-semibold">{FLOW_CONDITION_LABELS[condition.condition_type]}</span>
            {typeof condition.value === 'string' || typeof condition.value === 'number' ? <span>: {String(condition.value)}</span> : null}
          </div>)}
          <Handle type="source" position={Position.Right} id={group.id} style={{ ...HANDLE_STYLE, background: '#00a884', right: -18, top: '50%' }} />
        </div>
      </div>)}
      <div className="relative rounded-md border border-red-200 bg-white/70 px-2 py-1.5 text-[9px] font-bold text-red-500 dark:border-red-900 dark:bg-[#173b59] dark:text-red-400">
        Ninguna de las condiciones
        <Handle type="source" position={Position.Right} id={FlowHandle.No} style={{ ...HANDLE_STYLE, background: '#ef4444', right: -18, top: '50%' }} />
      </div>
    </div>
  </NodeShell>
})

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
  const storedConditions = data.conditions ?? []
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
  const buttons = data.buttons ?? []
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

/** Una fila por salida, en el mismo orden en que el motor las va repartiendo:
 *  la ejecución 1 sale por la primera, la 2 por la segunda, y al llegar a la
 *  última vuelve a empezar. */
const RoundRobinNode = memo(({ id, data, selected }: NodeProps<CanvasNode>) => {
  const outputs = data.outputs ?? []
  return (
    <NodeShell id={id} type={FlowNodeType.RoundRobin} data={data} selected={selected}>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <div className="mt-2 space-y-1">
        {outputs.map((output, index) => (
          <div key={output.id} className="relative flex items-center gap-1.5 rounded-md border border-teal-200 bg-white/70 px-2 py-1.5 text-[9px] font-semibold text-gray-600 dark:border-teal-900 dark:bg-[#173b59] dark:text-gray-200">
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[8px] font-bold text-teal-700 dark:bg-teal-900 dark:text-teal-200">{index + 1}</span>
            <span className="truncate">{output.label || `Salida ${index + 1}`}</span>
            <Handle
              type="source" position={Position.Right} id={output.id}
              style={{ ...HANDLE_STYLE, background: '#0d9488', right: -18, top: '50%' }}
            />
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
  [FlowNodeType.InvokeFlow]: InvokeFlowNode,
  [FlowNodeType.Wait]: LegacyPauseNode,
  [FlowNodeType.WaitAny]: PauseNode,
  [FlowNodeType.Question]: QuestionNode,
  [FlowNodeType.RoundRobin]: RoundRobinNode,
  [FlowNodeType.End]: EndNode,
}

interface DeletableEdgeData extends Record<string, unknown> {
  showDelete: boolean
  onDelete: (id: string) => void
  onToolbarEnter: (id: string) => void
  onToolbarLeave: (id: string) => void
}

type DeletableEdge = Edge<DeletableEdgeData, 'deletable'>

function DeletableConnection({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  markerEnd, style, interactionWidth, label, labelStyle, labelShowBg,
  labelBgStyle, labelBgPadding, labelBgBorderRadius, data,
}: EdgeProps<DeletableEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  })
  return <>
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={interactionWidth}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelStyle={labelStyle}
      labelShowBg={labelShowBg}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
    />
    <EdgeToolbar edgeId={id} x={labelX} y={labelY - 24} isVisible={data?.showDelete === true} className="nodrag nopan">
      <button
        type="button"
        title="Eliminar conexión"
        aria-label="Eliminar conexión"
        onMouseEnter={() => data?.onToolbarEnter(id)}
        onMouseLeave={() => data?.onToolbarLeave(id)}
        onClick={event => { event.stopPropagation(); data?.onDelete(id) }}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-red-200 bg-white text-red-500 shadow-md transition hover:bg-red-50 hover:text-red-600 dark:border-red-900 dark:bg-wa-panel-dark dark:hover:bg-red-950"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </EdgeToolbar>
  </>
}

const EDGE_TYPES: EdgeTypes = { deletable: DeletableConnection }

const BUTTON_COLORS = ['#00a884', '#0891b2', '#7c3aed']

interface FlowCanvasProps {
  flow: AutomationFlowDefinition
  templates?: MessageTemplate[]
  mediaAssets?: MediaAsset[]
  flowRules?: AutomationRule[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onMoveNodes: (moves: Array<{ id: string; position: { x: number; y: number } }>) => void
  onDeleteNodes: (ids: string[]) => void
  onConnect: (edge: AutomationFlowEdge) => void
  onDeleteEdge: (id: string) => void
  onDropNewNode: (type: AutomationFlowNodeType, position: { x: number; y: number }) => void
}

function Canvas({
  flow, templates = EMPTY_TEMPLATES, mediaAssets = EMPTY_MEDIA_ASSETS, flowRules = EMPTY_FLOW_RULES, selectedId, onSelect, onMoveNodes, onDeleteNodes, onConnect, onDeleteEdge, onDropNewNode,
}: FlowCanvasProps) {
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [connectionHighlightEnabled, setConnectionHighlightEnabled] = useState(storedConnectionHighlightPreference)
  const nodeLeaveTimer = useRef<number | null>(null)
  const edgeLeaveTimer = useRef<number | null>(null)

  const highlightedEdgeIds = useMemo(() => {
    if (!connectionHighlightEnabled) return new Set<string>()
    const activeEdgeId = hoveredEdgeId ?? selectedEdgeId
    if (activeEdgeId) return new Set([activeEdgeId])
    if (!hoveredNodeId) return new Set<string>()
    return new Set(
      flow.edges
        .filter(edge => edge.source === hoveredNodeId || edge.target === hoveredNodeId)
        .map(edge => edge.id),
    )
  }, [flow.edges, hoveredEdgeId, selectedEdgeId, hoveredNodeId, connectionHighlightEnabled])

  const connectionRoles = useMemo(() => {
    const roles = new Map<string, 'source' | 'target' | 'both'>()
    const addRole = (nodeId: string, role: 'source' | 'target') => {
      const current = roles.get(nodeId)
      roles.set(nodeId, current && current !== role ? 'both' : role)
    }
    for (const edge of flow.edges) {
      if (!highlightedEdgeIds.has(edge.id)) continue
      addRole(edge.source, 'source')
      addRole(edge.target, 'target')
    }
    return roles
  }, [flow.edges, highlightedEdgeIds])

  const derivedNodes = useMemo<CanvasNode[]>(() => flow.nodes.map(node => {
    const action = node.type === FlowNodeType.Action ? node.data.action : null
    const previewTemplate = action?.type === AutomationActionType.SendTemplate
      ? templates.find(template => template.id === action.template_id)
      : undefined
    const previewAsset = action?.type === AutomationActionType.SendAudio || action?.type === AutomationActionType.SendAttachment || action?.type === AutomationActionType.SendMedia
      ? mediaAssets.find(asset => asset.id === action.media_asset_id)
      : undefined
    const invokedFlowName = node.type === FlowNodeType.InvokeFlow
      ? flowRules.find(rule => rule.id === node.data.flow_rule_id)?.name
      : undefined
    return {
      id: node.id,
      type: node.type,
      position: node.position,
      selected: node.id === selectedId,
      data: {
        ...node.data,
        previewTemplate,
        previewAsset,
        invokedFlowName,
        onDelete: id => onDeleteNodes([id]),
      },
    }
  }), [flow.nodes, templates, mediaAssets, flowRules, selectedId, onDeleteNodes])

  // Estado local para que el arrastre se vea moverse en vivo: `flow.nodes`
  // (la prop) solo se actualiza al soltar (ver más abajo), así que si
  // ReactFlow dependiera directo de `derivedNodes` el nodo no se movería
  // hasta ese momento. Se resincroniza cada vez que cambia lo que viene del
  // padre (agregar/borrar bloque, publicar, etc.) — eso nunca pasa a mitad
  // de un arrastre porque durante el arrastre no se llama a onMoveNodes.
  const [nodes, setNodes] = useState<CanvasNode[]>(derivedNodes)
  useEffect(() => {
    setNodes(current => {
      const selectedById = new Map(current.map(node => [node.id, node.selected]))
      return derivedNodes.map(node => ({
        ...node,
        // Mover el grupo actualiza `flow` en el padre; conservar esta marca
        // evita perder la selección múltiple al sincronizar las posiciones.
        selected: selectedById.get(node.id) ?? node.selected,
      }))
    })
  }, [derivedNodes])

  // El estado de hover se aplica solo a la vista que recibe React Flow; no se
  // reinyecta en `nodes`. Resincronizar el estado base en cada mouseenter podía
  // reemplazar el elemento bajo el cursor y disparar mouseleave/mouseenter en
  // bucle, produciendo el parpadeo continuo.
  const displayNodes = useMemo<CanvasNode[]>(() => nodes.map(node => ({
    ...node,
    data: {
      ...node.data,
      connectionRole: connectionRoles.get(node.id),
      connectionDimmed: highlightedEdgeIds.size > 0 && !connectionRoles.has(node.id),
    },
  })), [nodes, connectionRoles, highlightedEdgeIds])

  const scheduleEdgeLeave = useCallback((edgeId: string) => {
    if (edgeLeaveTimer.current !== null) window.clearTimeout(edgeLeaveTimer.current)
    edgeLeaveTimer.current = window.setTimeout(() => {
      setHoveredEdgeId(current => current === edgeId ? null : current)
      edgeLeaveTimer.current = null
    }, 160)
  }, [])

  const keepEdgeHovered = useCallback((edgeId: string) => {
    if (edgeLeaveTimer.current !== null) {
      window.clearTimeout(edgeLeaveTimer.current)
      edgeLeaveTimer.current = null
    }
    setHoveredEdgeId(edgeId)
  }, [])

  const edges = useMemo<DeletableEdge[]>(
    () => toCanvasEdges(flow.edges, highlightedEdgeIds, selectedEdgeId, hoveredEdgeId).map(edge => ({
      ...edge,
      type: 'deletable' as const,
      data: {
        showDelete: edge.id === hoveredEdgeId || edge.id === selectedEdgeId,
        onDelete: onDeleteEdge,
        onToolbarEnter: keepEdgeHovered,
        onToolbarLeave: scheduleEdgeLeave,
      },
    })),
    [flow.edges, highlightedEdgeIds, hoveredEdgeId, keepEdgeHovered, onDeleteEdge, scheduleEdgeLeave, selectedEdgeId],
  )

  useEffect(() => {
    if (selectedEdgeId && !flow.edges.some(edge => edge.id === selectedEdgeId)) setSelectedEdgeId(null)
    if (hoveredEdgeId && !flow.edges.some(edge => edge.id === hoveredEdgeId)) setHoveredEdgeId(null)
  }, [flow.edges, selectedEdgeId, hoveredEdgeId])

  useEffect(() => {
    try {
      window.localStorage.setItem(CONNECTION_HIGHLIGHT_STORAGE_KEY, String(connectionHighlightEnabled))
    } catch {
      // La preferencia es opcional (p. ej. almacenamiento bloqueado).
    }
    if (!connectionHighlightEnabled) {
      setHoveredEdgeId(null)
      setHoveredNodeId(null)
    }
  }, [connectionHighlightEnabled])

  useEffect(() => () => {
    if (nodeLeaveTimer.current !== null) window.clearTimeout(nodeLeaveTimer.current)
    if (edgeLeaveTimer.current !== null) window.clearTimeout(edgeLeaveTimer.current)
  }, [])

  const handleNodeMouseEnter = useCallback((_: React.MouseEvent, node: CanvasNode) => {
    if (!connectionHighlightEnabled) return
    if (nodeLeaveTimer.current !== null) {
      window.clearTimeout(nodeLeaveTimer.current)
      nodeLeaveTimer.current = null
    }
    setHoveredNodeId(node.id)
  }, [connectionHighlightEnabled])

  const handleNodeMouseLeave = useCallback((_: React.MouseEvent, node: CanvasNode) => {
    if (nodeLeaveTimer.current !== null) window.clearTimeout(nodeLeaveTimer.current)
    // Un margen mínimo absorbe los leave/enter sintéticos que React Flow puede
    // emitir al actualizar estilos, sin volver pegajoso el resaltado real.
    nodeLeaveTimer.current = window.setTimeout(() => {
      setHoveredNodeId(current => current === node.id ? null : current)
      nodeLeaveTimer.current = null
    }, 80)
  }, [])

  const handleNodesChange = useCallback<OnNodesChange<CanvasNode>>(changes => {
    // Las eliminaciones se reflejan cuando el padre actualiza `flow`. No se
    // aplican antes localmente porque el disparador puede formar parte del
    // rectángulo y debe conservarse aunque se pulse Supr.
    setNodes(current => applyNodeChanges(changes.filter(change => change.type !== 'remove'), current))
    const moves: Array<{ id: string; position: { x: number; y: number } }> = []
    const removedIds: string[] = []
    for (const change of changes) {
      if (change.type === 'position' && change.position && !change.dragging) {
        // Solo al soltar: persistir en cada frame del arrastre dispararía un
        // render del builder entero por cada píxel movido.
        moves.push({
          id: change.id,
          position: {
            x: Math.round(change.position.x),
            y: Math.round(change.position.y),
          },
        })
      }
      if (change.type === 'remove') removedIds.push(change.id)
    }
    if (moves.length) onMoveNodes(moves)
    if (removedIds.length) onDeleteNodes(removedIds)
  }, [onMoveNodes, onDeleteNodes])

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
      x: Math.round(position.x),
      y: Math.round(position.y),
    })
  }, [screenToFlowPosition, onDropNewNode])

  return (
    <div ref={wrapper} className="h-full w-full">
      <ReactFlow
        className="bg-wa-field dark:bg-[#0d2230]"
        nodes={displayNodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={handleNodesChange}
        onEdgesChange={changes => changes.forEach(change => {
          if (change.type === 'remove') onDeleteEdge(change.id)
          if (change.type === 'select') setSelectedEdgeId(change.selected ? change.id : null)
        })}
        onConnect={handleConnect}
        isValidConnection={isValidConnection}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onEdgeMouseEnter={(_, edge) => keepEdgeHovered(edge.id)}
        onEdgeMouseLeave={(_, edge) => scheduleEdgeLeave(edge.id)}
        onEdgeClick={(event, edge) => {
          event.stopPropagation()
          setSelectedEdgeId(current => current === edge.id ? null : edge.id)
          onSelect(null)
        }}
        onNodeClick={(_, node) => { setSelectedEdgeId(null); onSelect(node.id) }}
        onPaneClick={() => { setSelectedEdgeId(null); onSelect(null) }}
        onSelectionStart={() => { setSelectedEdgeId(null); onSelect(null) }}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
        onDrop={handleDrop}
        colorMode="system"
        fitView
        proOptions={{ hideAttribution: false }}
        deleteKeyCode={['Backspace', 'Delete']}
        defaultEdgeOptions={{ animated: true, type: 'smoothstep' }}
        selectionOnDrag
        selectionMode={SelectionMode.Full}
        multiSelectionKeyCode={['Control', 'Meta']}
        panOnDrag={[1, 2]}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll={false}
        zoomOnPinch
        zoomActivationKeyCode="Control"
        zoomOnDoubleClick={false}
        minZoom={0.2}
      >
        <Background gap={22} size={1} className="opacity-60" />
        <Controls position="top-right" orientation="horizontal" showInteractive={false}>
          <ControlButton
            onClick={() => setConnectionHighlightEnabled(enabled => !enabled)}
            title={connectionHighlightEnabled ? 'Ocultar resaltado de rutas' : 'Resaltar rutas'}
            aria-label={connectionHighlightEnabled ? 'Ocultar resaltado de rutas' : 'Resaltar rutas'}
            aria-pressed={connectionHighlightEnabled}
          >
            {connectionHighlightEnabled ? <Eye className="h-4 w-4 text-violet-600" /> : <EyeOff className="h-4 w-4" />}
          </ControlButton>
        </Controls>
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
