import { MarkerType, type Connection, type Edge } from '@xyflow/react'

import {
FlowHandle,
FlowNodeType,
QuestionHandle,
WAIT_ANY_CONDITION_LABELS,
WaitAnyConditionKind,
} from '../../domain/automationCatalog'
import type { AutomationFlowEdge, AutomationFlowNode } from '../../types'

const EMPTY_HIGHLIGHTED_EDGE_IDS = new Set<string>()

const NEUTRAL_EDGE = '#94a3b8'
/** Salidas de cada grupo de un bloque Condición y de cada salida del Reparto. */
export const CONDITION_GROUP_COLOR = '#00a884'
export const ROUND_ROBIN_OUTPUT_COLOR = '#0d9488'
/** Los botones de una Pregunta, en orden. */
export const BUTTON_COLORS = ['#00a884', '#0891b2', '#7c3aed']

/** El color de cada salida con nombre fijo. El punto de la salida en el bloque
 *  y la conexión que sale de él usan el mismo. */
export const HANDLE_COLORS: Record<string, string> = {
  [FlowHandle.Yes]: '#00a884',
  [FlowHandle.No]: '#ef4444',
  [FlowHandle.Next]: NEUTRAL_EDGE,
  [WaitAnyConditionKind.Timer]: '#0891b2',
  [WaitAnyConditionKind.Message]: '#7c3aed',
  [WaitAnyConditionKind.BusinessHours]: '#f59e0b',
  [WaitAnyConditionKind.MediaPlayed]: '#db2777',
  [WaitAnyConditionKind.MediaReceived]: '#059669',
  [QuestionHandle.Media]: '#059669',
  [QuestionHandle.Other]: '#6b7280',
  [QuestionHandle.Timeout]: '#ef4444',
}

/**
 * El color de la conexión que sale por `handle`. Las salidas que no tienen un
 * nombre fijo (cada botón, cada grupo de una Condición, cada salida del
 * Reparto) dependen del bloque. Antes esas conexiones salían grises aunque el
 * punto de la salida tuviera color, y no se podía seguir qué botón iba adónde.
 */
export function handleColor(source: AutomationFlowNode | undefined, handle: string): string {
  const fixed = HANDLE_COLORS[handle]
  if (fixed) return fixed
  if (source?.type === FlowNodeType.Condition) return CONDITION_GROUP_COLOR
  if (source?.type === FlowNodeType.RoundRobin) return ROUND_ROBIN_OUTPUT_COLOR
  if (source?.type === FlowNodeType.Question) {
    const index = source.data.buttons?.findIndex(button => button.id === handle) ?? -1
    if (index >= 0) return BUTTON_COLORS[index % BUTTON_COLORS.length]
  }
  return NEUTRAL_EDGE
}

export const EDGE_LABELS: Record<string, string> = {
  [FlowHandle.Yes]: 'Sí',
  [FlowHandle.No]: 'No',
  [WaitAnyConditionKind.Timer]: 'Temporizador',
  [WaitAnyConditionKind.Message]: WAIT_ANY_CONDITION_LABELS[WaitAnyConditionKind.Message],
  [WaitAnyConditionKind.BusinessHours]: WAIT_ANY_CONDITION_LABELS[WaitAnyConditionKind.BusinessHours],
  [WaitAnyConditionKind.MediaPlayed]: WAIT_ANY_CONDITION_LABELS[WaitAnyConditionKind.MediaPlayed],
  [QuestionHandle.Other]: 'Otra respuesta',
  [QuestionHandle.Timeout]: 'Sin respuesta',
}

/** Clase de las conexiones del recorrido resaltado; las demás se atenúan por
 *  CSS (`.flow-spotlight`, ver index.css) sin tocar sus objetos. */
export const LIT_EDGE_CLASS = 'flow-lit'

interface EdgeCacheEntry { source: AutomationFlowEdge; color: string; highlighted: boolean; hovered: boolean; selected: boolean; edge: Edge }
const edgeCache = new WeakMap<AutomationFlowEdge, EdgeCacheEntry>()

/**
 * Cada conexión conserva su objeto mientras no cambie su estado (resaltada,
 * con el mouse encima, elegida). Antes el atenuado de "todas las demás" al
 * pasar el mouse cambiaba el estilo de las 49 conexiones y React las volvía
 * a crear todas, dos veces por bloque recorrido; eso, más el mismo efecto en
 * los bloques, era lo que hacía lenta la pantalla en flujos grandes.
 */
export function toCanvasEdges(
  edges: AutomationFlowEdge[],
  highlightedEdgeIds: ReadonlySet<string> = EMPTY_HIGHLIGHTED_EDGE_IDS,
  selectedEdgeId: string | null = null,
  hoveredEdgeId: string | null = null,
  colorOf: (edge: AutomationFlowEdge) => string = edge => HANDLE_COLORS[edge.source_handle] ?? NEUTRAL_EDGE,
): Edge[] {
  return edges.map(edge => {
    const highlighted = highlightedEdgeIds.has(edge.id)
    const hovered = edge.id === hoveredEdgeId
    const selected = edge.id === selectedEdgeId
    const color = colorOf(edge)
    const cached = edgeCache.get(edge)
    if (cached && cached.source === edge && cached.color === color && cached.highlighted === highlighted && cached.hovered === hovered && cached.selected === selected) return cached.edge
    const built = buildEdge(edge, color, highlighted, hovered, selected)
    edgeCache.set(edge, { source: edge, color, highlighted, hovered, selected, edge: built })
    return built
  })
}

function buildEdge(edge: AutomationFlowEdge, color: string, highlighted: boolean, hovered: boolean, selected: boolean): Edge {
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.source_handle,
      className: highlighted || hovered ? LIT_EDGE_CLASS : undefined,
      label: highlighted ? (EDGE_LABELS[edge.source_handle] ?? 'Siguiente') : EDGE_LABELS[edge.source_handle],
      // Solo se anima el recorrido resaltado. Con todas animadas, un flujo de
      // 50 bloques redibujaba cada conexión 60 veces por segundo sin que nadie
      // tocara nada (~16% del hilo principal en reposo) y la pantalla de
      // Automatizaciones se volvía lenta en equipos modestos (2026-11-08).
      animated: highlighted && !hovered,
      selected,
      type: 'smoothstep',
      interactionWidth: 32,
      style: {
        stroke: color,
        strokeWidth: highlighted ? 4 : hovered ? 3 : 2,
        filter: highlighted
          ? `drop-shadow(0 0 5px ${color})`
          : hovered
            ? `drop-shadow(0 0 2px ${color})`
            : undefined,
      },
      // Fondo y texto de la etiqueta según el tema (variables en index.css).
      labelStyle: {
        fill: highlighted ? color : 'var(--flow-edge-label-text)',
        fontSize: highlighted ? 11 : 10,
        fontWeight: highlighted ? 700 : 600,
      },
      labelShowBg: true,
      labelBgStyle: { fill: 'var(--flow-edge-label-bg)', fillOpacity: highlighted ? 0.96 : 0.92 },
      labelBgPadding: highlighted ? [6, 4] as [number, number] : [4, 2] as [number, number],
      labelBgBorderRadius: 6,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: highlighted ? 24 : hovered ? 20 : 18,
        height: highlighted ? 24 : hovered ? 20 : 18,
      },
    }
}

export function fromCanvasEdge(edge: Edge | Connection, id: string): AutomationFlowEdge {
  const handle = edge.sourceHandle
  return {
    id,
    source: edge.source,
    target: edge.target,
    source_handle: (typeof handle === 'string' && handle ? handle : FlowHandle.Next) as AutomationFlowEdge['source_handle'],
  }
}
