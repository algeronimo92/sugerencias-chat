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
    expect(active.className).toBe('flow-lit')
    expect(active.style).toMatchObject({ strokeWidth: 4 })
    expect(active.zIndex).toBeUndefined()

    // La inactiva no cambia: el atenuado lo pone el CSS del contenedor, así
    // pasar el mouse no vuelve a crear las 49 conexiones.
    expect(inactive.animated).toBe(false)
    expect(inactive.className).toBeUndefined()
    expect(inactive.style).toMatchObject({ strokeWidth: 2 })
    expect(inactive.style?.opacity).toBeUndefined()
  })

  it('en reposo, todas visibles y quietas: animarlas redibujaba el lienzo sin parar', () => {
    const edges = toCanvasEdges(FLOW_EDGES)

    expect(edges.some(edge => edge.animated)).toBe(false)
    expect(edges.every(edge => edge.className === undefined)).toBe(true)
    // Y conservan su objeto mientras nada cambie.
    expect(toCanvasEdges(FLOW_EDGES)[0]).toBe(edges[0])
    expect(toCanvasEdges(FLOW_EDGES, new Set(['edge-a-b']))[1]).toBe(edges[1])
  })

  it('aplica un resaltado leve al hover sin atenuar las otras conexiones', () => {
    const [hovered, other] = toCanvasEdges(FLOW_EDGES, new Set(), null, 'edge-a-b')

    expect(hovered.style).toMatchObject({ strokeWidth: 3 })
    expect(String(hovered.style?.filter)).toContain('drop-shadow(0 0 2px')
    expect(hovered.animated).toBe(false)
    expect(hovered.className).toBe('flow-lit')
    expect(hovered.label).toBeUndefined()
    expect(other.animated).toBe(false)
    expect(other.style).toMatchObject({ strokeWidth: 2 })
  })
})
