import { describe, expect, it } from 'vitest'
import type { AutomationFlowEdge } from '../types'
import { edgesAfterRemovingOutput } from './positionalOutputs'

const edge = (source: string, handle: string, target: string): AutomationFlowEdge => ({
  id: `${source}-${handle}`, source, target, source_handle: handle,
})

describe('edgesAfterRemovingOutput', () => {
  // Sí → agendar, No → despedir, Más tarde → recordar.
  const edges = [
    edge('q', 'btn_1', 'agendar'),
    edge('q', 'btn_2', 'despedir'),
    edge('q', 'btn_3', 'recordar'),
    edge('q', 'timeout', 'sin-respuesta'),
    edge('otro', 'btn_2', 'aparte'),
  ]
  const routes = (list: AutomationFlowEdge[]) => list.map(item => `${item.source}.${item.source_handle}→${item.target}`)

  it('a button keeps its own route when one before it is removed', () => {
    // Antes «Más tarde» heredaba «despedir», la ruta del botón borrado.
    expect(routes(edgesAfterRemovingOutput(edges, 'q', 'btn_', 1))).toEqual([
      'q.btn_1→agendar',
      'q.btn_2→recordar',
      'q.timeout→sin-respuesta',
      'otro.btn_2→aparte',
    ])
  })

  it('removing the first one shifts every other', () => {
    expect(routes(edgesAfterRemovingOutput(edges, 'q', 'btn_', 0)).slice(0, 2)).toEqual(['q.btn_1→despedir', 'q.btn_2→recordar'])
  })

  it('removing the last one only drops its connection', () => {
    expect(routes(edgesAfterRemovingOutput(edges, 'q', 'btn_', 2)).slice(0, 2)).toEqual(['q.btn_1→agendar', 'q.btn_2→despedir'])
  })

  it('leaves fixed outputs and other blocks alone', () => {
    const result = edgesAfterRemovingOutput(edges, 'q', 'btn_', 0)
    expect(routes(result)).toContain('q.timeout→sin-respuesta')
    expect(routes(result)).toContain('otro.btn_2→aparte')
  })

  it('an unconnected removed output changes nothing but the numbering', () => {
    const partial = [edge('q', 'btn_1', 'agendar'), edge('q', 'btn_3', 'recordar')]
    expect(routes(edgesAfterRemovingOutput(partial, 'q', 'btn_', 1))).toEqual(['q.btn_1→agendar', 'q.btn_2→recordar'])
  })

  it('keeps the edge ids so the canvas does not redraw unrelated lines', () => {
    expect(edgesAfterRemovingOutput(edges, 'q', 'btn_', 1).map(item => item.id)).toEqual(['q-btn_1', 'q-btn_3', 'q-timeout', 'otro-btn_2'])
  })
})
