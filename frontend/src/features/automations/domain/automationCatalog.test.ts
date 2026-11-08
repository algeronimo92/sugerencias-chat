import { describe, expect, it } from 'vitest'
import { automationStepLabel } from './automationCatalog'

describe('automationStepLabel', () => {
  it('names the steps that are neither an action nor a block', () => {
    expect(automationStepLabel('entry_conditions')).toBe('Condiciones de entrada')
    expect(automationStepLabel('flow')).toBe('Flujo')
    expect(automationStepLabel('action')).toBe('Acción')
  })

  it('uses the renamed blocks and actions', () => {
    expect(automationStepLabel('invoke_flow')).toBe('Iniciar otro flujo')
    expect(automationStepLabel('round_robin')).toBe('Reparto por turnos')
    expect(automationStepLabel('send_media')).toBe('Enviar archivo con texto')
    expect(automationStepLabel('change_service')).toBe('Cambiar/quitar servicio de interés')
  })

  it('falls back to a generic name or the raw code', () => {
    expect(automationStepLabel(null)).toBe('Paso')
    expect(automationStepLabel('something_new')).toBe('something_new')
  })
})
