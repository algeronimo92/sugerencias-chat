import { describe, expect, it } from 'vitest'
import type { AutomationExecution } from '../types'
import { attentionCount, groupAttention } from './attention'

const NOW = new Date('2026-11-23T15:00:00Z').getTime()
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString()

function execution(overrides: Partial<AutomationExecution>): AutomationExecution {
  return { id: 1, status: 'failed', error: null, error_code: null, rule_deleted: false, paused_at: null, attention_dismissed_at: null, ...overrides } as AutomationExecution
}

describe('groupAttention', () => {
  it('groups failures by what the person has to do about them', () => {
    const groups = groupAttention([
      execution({ id: 1, error: 'El lead no tiene vendedor asignado' }),
      execution({ id: 2, error_code: 'service_window_closed', error: 'Ventana cerrada' }),
      execution({ id: 3, error: 'La plantilla no está aprobada' }),
      execution({ id: 4, error_code: 'service_window_closed' }),
    ], NOW)

    // Lo que no le llegó al cliente va primero.
    expect(groups.map(group => [group.cause, group.executions.map(item => item.id)])).toEqual([
      ['service_window', [2, 4]],
      ['failed', [3]],
      ['no_seller', [1]],
    ])
    expect(attentionCount(groups)).toBe(4)
  })

  it('a pause only asks for attention once it has been forgotten', () => {
    const groups = groupAttention([
      execution({ id: 1, status: 'paused', paused_at: daysAgo(2) }),
      execution({ id: 2, status: 'paused', paused_at: daysAgo(30) }),
      execution({ id: 3, status: 'paused', paused_at: null }),
    ], NOW)

    expect(groups.map(group => [group.cause, group.executions.map(item => item.id)])).toEqual([['long_pause', [2]]])
  })

  it('leaves out what needs no decision', () => {
    expect(groupAttention([
      execution({ status: 'completed' }),
      execution({ status: 'cancelled' }),
      execution({ status: 'skipped' }),
      execution({ status: 'scheduled' }),
      // Sin automatización no hay nada que reintentar.
      execution({ status: 'failed', rule_deleted: true }),
      // Alguien ya la vio y la descartó.
      execution({ status: 'failed', attention_dismissed_at: '2026-11-23T10:00:00Z' }),
      execution({ status: 'paused', paused_at: daysAgo(30), attention_dismissed_at: '2026-11-23T10:00:00Z' }),
    ], NOW)).toEqual([])
  })
})
