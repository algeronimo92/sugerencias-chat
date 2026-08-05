import { MarkerType, type Connection, type Edge } from '@xyflow/react'

import type { AutomationFlowEdge } from '../../types'
import {
  FlowHandle,
  QuestionHandle,
  WAIT_ANY_CONDITION_LABELS,
  WaitAnyConditionKind,
} from '../../domain/automationCatalog'

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

export function toCanvasEdges(
  edges: AutomationFlowEdge[],
  highlightedEdgeIds: ReadonlySet<string> = EMPTY_HIGHLIGHTED_EDGE_IDS,
  selectedEdgeId: string | null = null,
  hoveredEdgeId: string | null = null,
): Edge[] {
  const hasHighlight = highlightedEdgeIds.size > 0
  return edges.map(edge => {
    const color = EDGE_COLORS[edge.source_handle] ?? '#94a3b8'
    const highlighted = highlightedEdgeIds.has(edge.id)
    const hovered = edge.id === hoveredEdgeId
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.source_handle,
      label: highlighted ? (EDGE_LABELS[edge.source_handle] ?? 'Siguiente') : EDGE_LABELS[edge.source_handle],
      animated: hovered ? false : hasHighlight ? highlighted : true,
      selected: edge.id === selectedEdgeId,
      type: 'smoothstep',
      interactionWidth: 32,
      style: {
        stroke: color,
        strokeWidth: highlighted ? 4 : hovered ? 3 : 2,
        opacity: hasHighlight && !highlighted ? 0.16 : 1,
        filter: highlighted
          ? `drop-shadow(0 0 5px ${color})`
          : hovered
            ? `drop-shadow(0 0 2px ${color})`
            : undefined,
        transition: 'stroke-width 160ms ease, opacity 160ms ease, filter 160ms ease',
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
  })
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
