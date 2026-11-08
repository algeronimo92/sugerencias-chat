import { describe, expect, it } from 'vitest'
import type { AutomationFlowEdge, AutomationFlowNode } from '../../types'
import { FlowHandle, FlowNodeType, QuestionHandle } from '../../domain/automationCatalog'
import { BUTTON_COLORS, CONDITION_GROUP_COLOR, HANDLE_COLORS, handleColor, ROUND_ROBIN_OUTPUT_COLOR, toCanvasEdges } from './flowCanvasEdges'

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

describe('handleColor', () => {
  const question: AutomationFlowNode = {
    id: 'q', type: FlowNodeType.Question, position: { x: 0, y: 0 },
    data: { text: '¿Te interesa?', buttons: [{ id: 'btn_1', label: 'Sí' }, { id: 'btn_2', label: 'Luego' }], timeout_seconds: 3600 },
  }
  const condition = { id: 'c', type: FlowNodeType.Condition, position: { x: 0, y: 0 }, data: {} } as AutomationFlowNode
  const reparto: AutomationFlowNode = { id: 'r', type: FlowNodeType.RoundRobin, position: { x: 0, y: 0 }, data: { outputs: [] } }

  it('cada conexión toma el color del punto de su salida, no gris', () => {
    // Antes botones, grupos de una Condición y salidas del Reparto salían grises.
    expect(handleColor(question, 'btn_2')).toBe(BUTTON_COLORS[1])
    expect(handleColor(condition, 'c-group-1')).toBe(CONDITION_GROUP_COLOR)
    expect(handleColor(reparto, 'out_1')).toBe(ROUND_ROBIN_OUTPUT_COLOR)
    expect(handleColor(question, QuestionHandle.Media)).toBe(HANDLE_COLORS[QuestionHandle.Media])
    expect(handleColor(undefined, FlowHandle.No)).toBe(HANDLE_COLORS[FlowHandle.No])
  })

  it('el color de la salida llega a la conexión y la etiqueta sigue el tema', () => {
    const edge: AutomationFlowEdge = { id: 'e', source: 'q', target: 'x', source_handle: 'btn_1' }
    const [built] = toCanvasEdges([edge], undefined, null, null, item => handleColor(question, item.source_handle))
    expect(built.style).toMatchObject({ stroke: BUTTON_COLORS[0] })
    expect(built.labelBgStyle).toMatchObject({ fill: 'var(--flow-edge-label-bg)' })
  })
})
