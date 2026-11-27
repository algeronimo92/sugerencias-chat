import { describe, expect, it } from 'vitest'
import { AUTOMATION_ACTION_GROUPS, AutomationActionType, automationStepLabel, noReplyDelay, noReplyLabel } from './automationCatalog'

describe('automationStepLabel', () => {
  it('names the steps that are neither an action nor a block', () => {
    expect(automationStepLabel('entry_conditions')).toBe('Condiciones de entrada')
    expect(automationStepLabel('flow')).toBe('Automatización')
    expect(automationStepLabel('action')).toBe('Acción')
  })

  it('uses the renamed blocks and actions', () => {
    expect(automationStepLabel('invoke_flow')).toBe('Iniciar otra automatización')
    expect(automationStepLabel('round_robin')).toBe('Reparto por turnos')
    expect(automationStepLabel('send_media')).toBe('Enviar archivo con texto')
    expect(automationStepLabel('change_service')).toBe('Cambiar/quitar servicio de interés')
  })

  it('falls back to a generic name or the raw code', () => {
    expect(automationStepLabel(null)).toBe('Paso')
    expect(automationStepLabel('something_new')).toBe('something_new')
  })
})

describe('AUTOMATION_ACTION_GROUPS', () => {
  it('cada acción aparece en un grupo, una sola vez', () => {
    const grouped = AUTOMATION_ACTION_GROUPS.flatMap(group => group.types)
    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...grouped].sort()).toEqual(Object.values(AutomationActionType).sort())
  })

  it('"Cambiar servicio" va con lo que ordena el lead, no con los mensajes', () => {
    const group = AUTOMATION_ACTION_GROUPS.find(item => item.types.includes(AutomationActionType.ChangeService))
    expect(group?.types).toContain(AutomationActionType.AddTag)
  })
})

describe('noReplyLabel', () => {
  it('dice cuánto espera con el mismo formato que la Espera', () => {
    expect(noReplyLabel(86400)).toBe('Sin respuesta tras 24h')
    expect(noReplyLabel(1800)).toBe('Sin respuesta tras 30min')
    expect(noReplyDelay(5400)).toBe('tras 1h 30min')
  })

  it('sin plazo conocido queda el nombre a secas', () => {
    expect(noReplyLabel(undefined)).toBe('Sin respuesta')
    expect(noReplyLabel(0)).toBe('Sin respuesta')
    expect(noReplyDelay(null)).toBe('')
  })
})
