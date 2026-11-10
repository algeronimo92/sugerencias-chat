import { describe, expect, it } from 'vitest'
import { FlowHandle, FlowNodeType } from './automationCatalog'
import { numberFlowNodes, reachableFromTrigger } from './flowNumbering'
import type { AutomationFlowDefinition } from '../types'

const at = { x: 0, y: 0 }

describe('numberFlowNodes', () => {
  it('numera siguiendo el recorrido desde el disparador y deja los sueltos al final', () => {
    const flow: Pick<AutomationFlowDefinition, 'nodes' | 'edges'> = {
      // El orden de la lista no es el del recorrido: así llega del backend tras editar.
      nodes: [
        { id: 'fin', type: FlowNodeType.End, position: at, data: { label: 'Fin' } },
        { id: 'suelto', type: FlowNodeType.End, position: at, data: { label: 'Suelto' } },
        { id: 'b', type: FlowNodeType.Action, position: at, data: { action: { type: 'send_message', text: 'b' } } },
        { id: 'inicio', type: FlowNodeType.Trigger, position: at, data: { trigger_type: 'manual' } },
        { id: 'a', type: FlowNodeType.Action, position: at, data: { action: { type: 'send_message', text: 'a' } } },
      ],
      edges: [
        { id: 'e1', source: 'inicio', target: 'a', source_handle: FlowHandle.Next },
        { id: 'e2', source: 'a', target: 'b', source_handle: FlowHandle.Next },
        { id: 'e3', source: 'b', target: 'fin', source_handle: FlowHandle.Next },
        // Un ciclo no numera dos veces.
        { id: 'e4', source: 'fin', target: 'a', source_handle: FlowHandle.Next },
      ],
    }
    expect(Object.fromEntries(numberFlowNodes(flow))).toEqual({ inicio: 1, a: 2, b: 3, fin: 4, suelto: 5 })
    expect([...reachableFromTrigger(flow)]).toEqual(['inicio', 'a', 'b', 'fin'])
  })
})
