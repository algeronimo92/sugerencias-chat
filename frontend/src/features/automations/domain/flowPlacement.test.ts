import { describe, expect, it } from 'vitest'
import type { AutomationFlowEdge, AutomationFlowNode } from '../types'
import { FlowHandle, FlowNodeType } from './automationCatalog'
import { placeNewNode } from './flowPlacement'

const trigger: AutomationFlowNode = { id: 'inicio', type: FlowNodeType.Trigger, position: { x: 0, y: 0 }, data: { trigger_type: 'manual' } } as AutomationFlowNode
const message: AutomationFlowNode = { id: 'saludo', type: FlowNodeType.Action, position: { x: 380, y: 0 }, data: { action: { type: 'send_message', text: 'Hola' } } } as AutomationFlowNode
const question: AutomationFlowNode = { id: 'pregunta', type: FlowNodeType.Question, position: { x: 760, y: 0 }, data: { text: '¿?', buttons: [], timeout_seconds: 60 } } as AutomationFlowNode
const next = (source: string, target: string): AutomationFlowEdge => ({ id: `${source}-${target}`, source, target, source_handle: FlowHandle.Next })

describe('placeNewNode', () => {
  it('con un bloque elegido y su salida libre, el nuevo va a su derecha y conectado', () => {
    expect(placeNewNode([trigger, message], [next('inicio', 'saludo')], 'saludo')).toEqual({
      position: { x: 760, y: 0 },
      from: { source: 'saludo', handle: FlowHandle.Next },
    })
  })

  it('no le quita la conexión a una salida ocupada, y no se encima', () => {
    const placement = placeNewNode([trigger, message], [next('inicio', 'saludo')], 'inicio')
    expect(placement.from).toBeUndefined()
    // A la derecha del disparador está "saludo": baja una fila.
    expect(placement.position).toEqual({ x: 380, y: 260 })
  })

  it('con varias salidas no elige por la usuaria: queda al lado, suelto', () => {
    expect(placeNewNode([trigger, question], [], 'pregunta').from).toBeUndefined()
  })

  it('sin bloque elegido, a la derecha del último', () => {
    expect(placeNewNode([trigger, message], [], null)).toEqual({ position: { x: 760, y: 0 } })
  })
})
