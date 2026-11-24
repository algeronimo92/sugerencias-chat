import { describe, expect, it } from 'vitest'
import type { AutomationExecution } from '../types'
import { executionOutcome, executionStatusLabel, heldByManualFlow, INTERNAL_ERROR_MESSAGE, outcomeFilter, readableExecutionError, stepResultDetail, stepStatusLabel } from './automationExecutions'

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

describe('stepResultDetail', () => {
  const lookups = {
    stageName: (key: string) => ({ agendado: 'Agendado' }[key] ?? key),
    userName: (id: number) => ({ 7: 'Ana' }[id]),
    tagName: (id: number) => ({ 3: 'Pidió precio' }[id]),
  }
  const detail = (result: Record<string, unknown>) => stepResultDetail(result as never, lookups)

  it('says what a non-message step actually did, with names instead of ids', () => {
    expect(detail({ type: 'change_stage', status: 'completed', stage: 'agendado' })).toBe('A la etapa «Agendado»')
    expect(detail({ type: 'assign_seller', status: 'completed', user_id: 7 })).toBe('A Ana')
    expect(detail({ type: 'notify', status: 'completed', user_id: 7 })).toBe('A Ana')
    expect(detail({ type: 'add_tag', status: 'completed', tag_id: 3 })).toBe('«Pidió precio»')
    expect(detail({ type: 'create_task', status: 'completed', task_id: 41 })).toBe('Tarea n.º 41')
    expect(detail({ type: 'change_service', status: 'completed', service: 'Hifu' })).toBe('«Hifu»')
  })

  it('explains a skipped step instead of leaving a bare «Omitido»', () => {
    expect(detail({ type: 'remove_tag', status: 'skipped', tag_id: 3 })).toBe('El lead no tenía «Pidió precio»')
  })

  it('does not break when what it referred to no longer exists', () => {
    expect(detail({ type: 'assign_seller', status: 'completed', user_id: 99 })).toBe('A alguien que ya no está en el equipo')
    expect(detail({ type: 'add_tag', status: 'completed', tag_id: 99 })).toBe('«una etiqueta eliminada»')
  })

  it('adds nothing to steps that have nothing to add', () => {
    expect(detail({ type: 'send_message', status: 'completed', message_ids: [1] })).toBeNull()
    expect(detail({ type: 'wait', status: 'scheduled', seconds: 60 })).toBeNull()
  })
})
