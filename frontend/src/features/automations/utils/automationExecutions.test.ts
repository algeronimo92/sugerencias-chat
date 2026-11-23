import { describe, expect, it } from 'vitest'
import { executionStatusLabel, INTERNAL_ERROR_MESSAGE, isManuallyCancelled, MANUAL_CANCEL_ERROR, readableExecutionError, stepStatusLabel } from './automationExecutions'

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

describe('readableExecutionError', () => {
  it('hides what only a programmer can read', () => {
    expect(readableExecutionError("('condition-1785962323144-gf4o', <FlowHandle.YES: 'yes'>)")).toBe(INTERNAL_ERROR_MESSAGE)
    expect(readableExecutionError('(sqlalchemy.dialects.postgresql.asyncpg.IntegrityError) <class ...')).toBe(INTERNAL_ERROR_MESSAGE)
  })

  it('keeps the messages written for people', () => {
    const closed = 'No se envió WhatsApp porque la ventana de 24 horas está cerrada'
    expect(readableExecutionError(closed)).toBe(closed)
    expect(readableExecutionError('Meta Graph API respondió 500: (#131000) Something went wrong')).toContain('131000')
    expect(readableExecutionError(null)).toBeNull()
  })
})
