import { describe, expect, it } from 'vitest'
import type { AutomationExecution } from '../types'
import { executionOutcome, executionStatusLabel, heldByManualFlow, INTERNAL_ERROR_MESSAGE, outcomeFilter, readableExecutionError, stepStatusLabel } from './automationExecutions'

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

describe('heldByManualFlow', () => {
  type Row = Pick<AutomationExecution, 'id' | 'status' | 'start_source' | 'parent_execution_id'>
  const followUp: Row = { id: 1, status: 'scheduled', start_source: 'system', parent_execution_id: null }
  const manual: Row = { id: 2, status: 'scheduled', start_source: 'manual', parent_execution_id: null }

  it('a follow-up waits for the manual flow launched after it', () => {
    expect(heldByManualFlow(followUp, [followUp, manual])).toBe(manual)
    expect(heldByManualFlow(followUp, [followUp, { ...manual, status: 'running' }])?.id).toBe(2)
  })

  it('the manual flow itself is not held, nor is anything by an older or frozen one', () => {
    expect(heldByManualFlow(manual, [followUp, manual])).toBeUndefined()
    expect(heldByManualFlow({ ...followUp, id: 3 }, [manual])).toBeUndefined()
    expect(heldByManualFlow(followUp, [{ ...manual, status: 'paused' }])).toBeUndefined()
    expect(heldByManualFlow(followUp, [{ ...manual, start_source: 'system' }])).toBeUndefined()
  })

  it('parent and child never hold each other', () => {
    expect(heldByManualFlow({ ...followUp, parent_execution_id: 2 }, [manual])).toBeUndefined()
    expect(heldByManualFlow(followUp, [{ ...manual, parent_execution_id: 1 }])).toBeUndefined()
  })
})

describe('executionOutcome', () => {
  const outcome = (status: string, delivery: string | null) => executionOutcome({ status, delivery_state: delivery } as Pick<AutomationExecution, 'status' | 'delivery_state'>)

  it('a completed run only reads as completed if its messages went out', () => {
    // Había «completadas» con mensajes que nunca salieron y se leían igual.
    expect(executionStatusLabel(outcome('completed', 'delivered'))).toBe('Completada')
    expect(executionStatusLabel(outcome('completed', null))).toBe('Completada')
    expect(executionStatusLabel(outcome('completed', 'pending'))).toBe('Enviando…')
    expect(executionStatusLabel(outcome('completed', 'failed'))).toBe('No se entregó')
  })

  it('what has not finished or already failed keeps its own state', () => {
    // «Falló» es peor noticia que un mensaje sin entregar: manda el estado.
    expect(outcome('failed', 'failed')).toBe('failed')
    expect(outcome('scheduled', 'pending')).toBe('scheduled')
    expect(outcome('cancelled', 'failed')).toBe('cancelled')
  })

  it('each label filters exactly the rows that show it', () => {
    expect(outcomeFilter('completed')).toEqual({ status: 'completed', delivery: 'ok' })
    expect(outcomeFilter('sending')).toEqual({ status: 'completed', delivery: 'pending' })
    expect(outcomeFilter('undelivered')).toEqual({ status: 'completed', delivery: 'failed' })
    expect(outcomeFilter('failed')).toEqual({ status: 'failed' })
  })
})
