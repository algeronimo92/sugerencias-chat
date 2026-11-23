import { describe, expect, it } from 'vitest'
import { executionStatusLabel, INTERNAL_ERROR_MESSAGE, readableExecutionError, stepStatusLabel } from './automationExecutions'

describe('executionStatusLabel', () => {
  it('tells a cancelled run apart from one that did not apply', () => {
    expect(executionStatusLabel('cancelled')).toBe('Cancelada')
    expect(executionStatusLabel('skipped')).toBe('No aplicó')
    expect(executionStatusLabel('failed')).toBe('Fallida')
  })

  it('falls back to the raw status when it is unknown', () => {
    expect(executionStatusLabel('archived')).toBe('archived')
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
