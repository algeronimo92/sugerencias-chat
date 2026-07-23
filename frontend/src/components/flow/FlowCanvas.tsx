import { memo, useCallback, useMemo, useRef } from 'react'
import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider,
  useReactFlow, type Connection, type Edge, type Node, type NodeProps, type NodeTypes,
  type OnConnect, type OnNodesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Activity, CheckCircle2, Clock3, Split, Trash2, Zap } from 'lucide-react'
import type {
  AutomationFlowDefinition, AutomationFlowEdge, AutomationFlowNode, AutomationFlowNodeType,
} from '../../types'
import {
  AUTOMATION_ACTION_LABELS, AUTOMATION_TRIGGERS, FLOW_CONDITION_LABELS, FLOW_NODE_LABELS,
  FlowHandle, FlowNodeType, isAutomationActionType, isFlowConditionType,
} from '../../domain/automationCatalog'

/** Datos del bloque tal como los guarda el backend, más lo que el lienzo
 *  necesita para dibujarlo (borrar, resaltar el seleccionado). */
type CanvasNodeData = Record<string, unknown> & {
  onDelete?: (id: string) => void
  isSelected?: boolean
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
  if (type === FlowNodeType.Wait) return `Esperar ${String(data.minutes ?? 0)} min`
  return String(data.label || 'Fin')
}

const TONES: Record<AutomationFlowNodeType, string> = {
  [FlowNodeType.Trigger]: 'border-wa-primary bg-green-50 dark:border-green-700 dark:bg-green-950/40',
  [FlowNodeType.Condition]: 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40',
  [FlowNodeType.Action]: 'border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/40',
  [FlowNodeType.Wait]: 'border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/40',
  [FlowNodeType.End]: 'border-gray-400 bg-wa-hover dark:border-gray-600 dark:bg-wa-head-dark',
}

const ICONS: Record<AutomationFlowNodeType, typeof Zap> = {
  [FlowNodeType.Trigger]: Zap,
  [FlowNodeType.Condition]: Split,
  [FlowNodeType.Action]: Activity,
  [FlowNodeType.Wait]: Clock3,
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
      className={`w-56 rounded-xl border-2 px-3 py-2.5 shadow-sm transition ${TONES[type]} ${
        selected ? 'ring-2 ring-wa-primary ring-offset-2 dark:ring-offset-gray-950' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-600 dark:text-gray-300" />
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-wide text-wa-muted">{FLOW_NODE_LABELS[type]}</p>
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

const TriggerNode = memo(({ id, data, selected }: NodeProps<CanvasNode>) => (
  <NodeShell id={id} type={FlowNodeType.Trigger} data={data} selected={selected}>
    <Handle type="source" position={Position.Right} id={FlowHandle.Next} style={HANDLE_STYLE} />
  </NodeShell>
))

const ActionNode = memo(({ id, data, selected }: NodeProps<CanvasNode>) => (
  <NodeShell id={id} type={FlowNodeType.Action} data={data} selected={selected}>
    <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Right} id={FlowHandle.Next} style={HANDLE_STYLE} />
  </NodeShell>
))

const WaitNode = memo(({ id, data, selected }: NodeProps<CanvasNode>) => (
  <NodeShell id={id} type={FlowNodeType.Wait} data={data} selected={selected}>
    <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
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
    <div className="mt-2 flex justify-end gap-3 text-[9px] font-bold">
      <span className="text-wa-primary-strong dark:text-wa-primary">Sí</span>
      <span className="text-red-500 dark:text-red-400">No</span>
    </div>
    <Handle
      type="source" position={Position.Right} id={FlowHandle.Yes}
      style={{ ...HANDLE_STYLE, background: '#00a884', top: '65%' }}
    />
    <Handle
      type="source" position={Position.Right} id={FlowHandle.No}
      style={{ ...HANDLE_STYLE, background: '#ef4444', top: '85%' }}
    />
  </NodeShell>
))

// Fuera del componente: React Flow re-monta todos los nodos si esta referencia
// cambia entre renders.
const NODE_TYPES: NodeTypes = {
  [FlowNodeType.Trigger]: TriggerNode,
  [FlowNodeType.Condition]: ConditionNode,
  [FlowNodeType.Action]: ActionNode,
  [FlowNodeType.Wait]: WaitNode,
  [FlowNodeType.End]: EndNode,
}

const EDGE_COLORS: Record<string, string> = {
  [FlowHandle.Yes]: '#00a884',
  [FlowHandle.No]: '#ef4444',
  [FlowHandle.Next]: '#94a3b8',
}

export function toCanvasEdges(edges: AutomationFlowEdge[]): Edge[] {
  return edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.source_handle,
    label: edge.source_handle === FlowHandle.Yes ? 'Sí' : edge.source_handle === FlowHandle.No ? 'No' : undefined,
    animated: true,
    style: { stroke: EDGE_COLORS[edge.source_handle] ?? '#94a3b8', strokeWidth: 2 },
  }))
}

export function fromCanvasEdge(edge: Edge | Connection, id: string): AutomationFlowEdge {
  const handle = edge.sourceHandle
  return {
    id,
    source: edge.source,
    target: edge.target,
    source_handle: (handle === FlowHandle.Yes || handle === FlowHandle.No ? handle : FlowHandle.Next),
  }
}

interface FlowCanvasProps {
  flow: AutomationFlowDefinition
  selectedId: string | null
  onSelect: (id: string | null) => void
  onMoveNode: (id: string, position: { x: number; y: number }) => void
  onDeleteNode: (id: string) => void
  onConnect: (edge: AutomationFlowEdge) => void
  onDeleteEdge: (id: string) => void
  onDropNewNode: (type: AutomationFlowNodeType, position: { x: number; y: number }) => void
}

function Canvas({
  flow, selectedId, onSelect, onMoveNode, onDeleteNode, onConnect, onDeleteEdge, onDropNewNode,
}: FlowCanvasProps) {
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()

  const nodes = useMemo<CanvasNode[]>(() => flow.nodes.map(node => ({
    id: node.id,
    type: node.type,
    position: node.position,
    selected: node.id === selectedId,
    data: { ...(node.data as Record<string, unknown>), onDelete: onDeleteNode },
  })), [flow.nodes, selectedId, onDeleteNode])

  const edges = useMemo(() => toCanvasEdges(flow.edges), [flow.edges])

  const handleNodesChange = useCallback<OnNodesChange<CanvasNode>>(changes => {
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
        defaultEdgeOptions={{ animated: true }}
        minZoom={0.2}
      >
        <Background gap={22} size={1} />
        <Controls showInteractive={false} />
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
