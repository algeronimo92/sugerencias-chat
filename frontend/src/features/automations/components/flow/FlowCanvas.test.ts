import { describe, expect, it } from 'vitest'
import type { AutomationFlowEdge } from '../../types'
import { FlowHandle } from '../../domain/automationCatalog'
import { toCanvasEdges } from './flowCanvasEdges'

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

  it('en reposo, todas visibles y quietas: animarlas redibujaba el lienzo sin parar', () => {
    const edges = toCanvasEdges(FLOW_EDGES)

    expect(edges.some(edge => edge.animated)).toBe(false)
    expect(edges.every(edge => edge.style?.opacity === 1)).toBe(true)
  })

  it('aplica un resaltado leve al hover sin atenuar las otras conexiones', () => {
    const [hovered, other] = toCanvasEdges(FLOW_EDGES, new Set(), null, 'edge-a-b')

    expect(hovered.style).toMatchObject({ strokeWidth: 3, opacity: 1 })
    expect(String(hovered.style?.filter)).toContain('drop-shadow(0 0 2px')
    expect(hovered.animated).toBe(false)
    expect(hovered.label).toBeUndefined()
    expect(other.animated).toBe(false)
    expect(other.style).toMatchObject({ strokeWidth: 2, opacity: 1 })
  })
})
