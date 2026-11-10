import { describe, expect, it } from 'vitest'
import { executionStatusLabel, isManuallyCancelled, MANUAL_CANCEL_ERROR, stepStatusLabel } from './automationExecutions'

describe('executionStatusLabel', () => {
  it('tells a manual cancel apart from a run that did not apply', () => {
    expect(executionStatusLabel('skipped', MANUAL_CANCEL_ERROR)).toBe('Cancelada')
    expect(executionStatusLabel('skipped', 'No cumple las condiciones de entrada')).toBe('Omitida')
    expect(executionStatusLabel('skipped')).toBe('Omitida')
    expect(executionStatusLabel('failed', MANUAL_CANCEL_ERROR)).toBe('Fallida')
  })

  it('falls back to the raw status when it is unknown', () => {
    expect(executionStatusLabel('archived')).toBe('archived')
  })
})

describe('isManuallyCancelled', () => {
  it('needs both the skipped status and the cancel marker', () => {
    expect(isManuallyCancelled({ status: 'skipped', error: MANUAL_CANCEL_ERROR })).toBe(true)
    expect(isManuallyCancelled({ status: 'skipped', error: null })).toBe(false)
    expect(isManuallyCancelled({ status: 'completed', error: MANUAL_CANCEL_ERROR })).toBe(false)
  })
})

describe('stepStatusLabel', () => {
  it('names the statuses only a test run (Probar) gives', () => {
    expect(stepStatusLabel('matched')).toBe('Entra al flujo')
    expect(stepStatusLabel('evaluated')).toBe('Revisado')
    expect(stepStatusLabel('would_run')).toBe('Se haría')
    expect(stepStatusLabel('would_wait')).toBe('Esperaría')
    expect(stepStatusLabel('would_fail')).toBe('Fallaría')
  })

  it('keeps the names of real steps', () => {
    expect(stepStatusLabel('completed')).toBe('Hecho')
    expect(stepStatusLabel('scheduled')).toBe('Esperando')
  })
})
