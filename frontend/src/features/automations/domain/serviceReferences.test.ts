import { describe, expect, it } from 'vitest'
import { AutomationActionType, FlowNodeType } from './automationCatalog'
import { actionNamesService, conditionsNameService, flowServiceReferences, flowServiceSummary, hasServiceReferences, onlyPart, ruleServiceSummary } from './serviceReferences'
import type { AutomationFlowDefinition } from '../types'

const changeService = (service: string | null) => ({ type: AutomationActionType.ChangeService, service })

describe('serviceReferences', () => {
  it('reconoce el servicio con otras mayúsculas, como el backend, y no por parecido', () => {
    expect(conditionsNameService({ service_contains: 'hollywood PEEL' }, 'Hollywood Peel')).toBe(true)
    expect(conditionsNameService({ service_contains: 'Hollywood' }, 'Hollywood Peel')).toBe(false)
    expect(conditionsNameService(null, 'Hollywood Peel')).toBe(false)
    expect(actionNamesService(changeService('Hollywood Peel'), 'hollywood peel')).toBe(true)
    expect(actionNamesService(changeService(null), 'Hollywood Peel')).toBe(false)
    expect(actionNamesService({ type: AutomationActionType.SendMessage, text: 'Hollywood Peel' }, 'Hollywood Peel')).toBe(false)
  })

  it('encuentra en un flujo las condiciones de entrada y los bloques que lo nombran', () => {
    const flow: AutomationFlowDefinition = {
      conditions: { service_contains: 'Hollywood Peel' },
      nodes: [
        { id: 'trigger', type: FlowNodeType.Trigger, position: { x: 0, y: 0 }, data: { trigger_type: 'manual' } },
        { id: 'a', type: FlowNodeType.Action, position: { x: 0, y: 0 }, data: { action: changeService('Hollywood Peel') } },
        { id: 'b', type: FlowNodeType.Action, position: { x: 0, y: 0 }, data: { action: changeService('Botox') } },
      ],
      edges: [],
    }
    const references = flowServiceReferences(flow, 'hollywood peel')
    expect(references).toEqual({ entryConditions: true, nodeIds: ['a'] })
    expect(hasServiceReferences(references)).toBe(true)
    // Desde Catálogos se marca solo lo que corresponde al enlace.
    expect(onlyPart(references, 'action')).toEqual({ entryConditions: false, nodeIds: ['a'] })
    expect(onlyPart(references, 'condition')).toEqual({ entryConditions: true, nodeIds: [] })
    expect(flowServiceSummary(references)).toBe('las condiciones de entrada ("Servicio de interés contiene") y el bloque "Cambiar/quitar servicio de interés"')
    expect(hasServiceReferences(flowServiceReferences(null, 'x'))).toBe(false)
  })

  it('resume una regla simple, y queda vacío cuando ya no lo usa', () => {
    expect(ruleServiceSummary(false, 2)).toBe('2 acciones "Cambiar/quitar servicio de interés"')
    expect(ruleServiceSummary(true, 0)).toBe('las condiciones ("Servicio de interés contiene")')
    expect(ruleServiceSummary(false, 0)).toBe('')
  })
})
