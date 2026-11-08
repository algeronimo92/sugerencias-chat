import { MarkerType, type Connection, type Edge } from '@xyflow/react'

import {
FlowHandle,
QuestionHandle,
WAIT_ANY_CONDITION_LABELS,
WaitAnyConditionKind,
} from '../../domain/automationCatalog'
import type { AutomationFlowEdge } from '../../types'

const EMPTY_HIGHLIGHTED_EDGE_IDS = new Set<string>()

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

interface EdgeCacheEntry { source: AutomationFlowEdge; highlighted: boolean; hovered: boolean; selected: boolean; edge: Edge }
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
): Edge[] {
  return edges.map(edge => {
    const highlighted = highlightedEdgeIds.has(edge.id)
    const hovered = edge.id === hoveredEdgeId
    const selected = edge.id === selectedEdgeId
    const cached = edgeCache.get(edge)
    if (cached && cached.source === edge && cached.highlighted === highlighted && cached.hovered === hovered && cached.selected === selected) return cached.edge
    const built = buildEdge(edge, highlighted, hovered, selected)
    edgeCache.set(edge, { source: edge, highlighted, hovered, selected, edge: built })
    return built
  })
}

function buildEdge(edge: AutomationFlowEdge, highlighted: boolean, hovered: boolean, selected: boolean): Edge {
    const color = EDGE_COLORS[edge.source_handle] ?? '#94a3b8'
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
      labelStyle: {
        fill: highlighted ? color : '#64748b',
        fontSize: highlighted ? 11 : 9,
        fontWeight: highlighted ? 700 : 600,
      },
      labelShowBg: true,
      labelBgStyle: { fill: '#ffffff', fillOpacity: highlighted ? 0.96 : 0.78 },
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
