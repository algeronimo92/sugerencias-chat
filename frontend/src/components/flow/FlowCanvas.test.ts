import { describe, expect, it } from 'vitest'
import type { AutomationFlowEdge } from '../../types'
import { FlowHandle } from '../../domain/automationCatalog'
import { toCanvasEdges } from './FlowCanvas'

const FLOW_EDGES: AutomationFlowEdge[] = [
  { id: 'edge-a-b', source: 'a', target: 'b', source_handle: FlowHandle.Next },
  { id: 'edge-b-c', source: 'b', target: 'c', source_handle: FlowHandle.Yes },
]

describe('toCanvasEdges', () => {
  it('resalta solo el recorrido activo sin elevarlo sobre los nodos', () => {
    const [active, inactive] = toCanvasEdges(FLOW_EDGES, new Set(['edge-a-b']), 'edge-a-b')

    expect(active.animated).toBe(true)
    expect(active.selected).toBe(true)
    expect(active.label).toBe('Siguiente')
    expect(active.style).toMatchObject({ strokeWidth: 4, opacity: 1 })
    expect(active.zIndex).toBeUndefined()

    expect(inactive.animated).toBe(false)
    expect(inactive.style).toMatchObject({ strokeWidth: 2, opacity: 0.16 })
  })

  it('mantiene todas las conexiones visibles cuando no hay hover', () => {
    const edges = toCanvasEdges(FLOW_EDGES)

    expect(edges.every(edge => edge.animated)).toBe(true)
    expect(edges.every(edge => edge.style?.opacity === 1)).toBe(true)
  })
})
