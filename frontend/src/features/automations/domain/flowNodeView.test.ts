import { describe, expect, it } from 'vitest'
import { FlowNodeType } from './automationCatalog'
import { FLOW_NODE_VIEW, flowNodeSummary } from './flowNodeView'

describe('FLOW_NODE_VIEW', () => {
  it('define vista para cada tipo de bloque', () => {
    expect(Object.keys(FLOW_NODE_VIEW).sort()).toEqual(Object.values(FlowNodeType).sort())
  })

  it('resume cada bloque con sus datos', () => {
    expect(flowNodeSummary('wait', { seconds: 90 })).toContain('Esperar')
    expect(flowNodeSummary('question', { buttons: [{ id: 'btn_1', label: 'Sí' }, { id: 'btn_2', label: 'No' }] })).toBe('Sí / No')
    expect(flowNodeSummary('round_robin', { outputs: [] })).toBe('Sin salidas')
    expect(flowNodeSummary('invoke_flow', {})).toBe('Selecciona un flujo')
    expect(flowNodeSummary('end', {})).toBe('Fin')
  })
})
