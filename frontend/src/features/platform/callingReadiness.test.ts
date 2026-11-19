import { describe, expect, it } from 'vitest'

import { canReceiveCallsPermission, messagingLimitLabel, readinessCopy } from './callingReadiness'
import type { AppUser, CallingReadiness } from './types'

const readiness = (overrides: Partial<CallingReadiness> = {}): CallingReadiness => ({
  state: 'ready', on_business_app: false, messaging_limit: 'TIER_2K', messaging_limit_ok: true, ...overrides,
})

const user = (overrides: Partial<AppUser> = {}): AppUser => ({
  id: 1, email: 'a@example.com', name: 'Ana', role: 'vendedor', is_active: true,
  invitation_pending: false, phone: null, can_handle_calls: false, ...overrides,
})

describe('messagingLimitLabel', () => {
  it.each([
    ['TIER_250', '250'],
    ['TIER_2K', '2000'],
    ['TIER_100K', '100000'],
    ['TIER_UNLIMITED', 'sin límite'],
    ['TIER_NO_ACCESS', null],
    [null, null],
  ])('%s → %s', (tier, label) => {
    expect(messagingLimitLabel(tier)).toBe(label)
  })
})

describe('readinessCopy', () => {
  it('pide mudar el número sin usar los nombres de Meta', () => {
    const copy = readinessCopy(readiness({ state: 'requires_migration', on_business_app: true }))
    expect(copy.tone).toBe('action')
    expect(copy.title).toMatch(/mudar el número/)
    expect(`${copy.title} ${copy.body}`).not.toMatch(/coexistencia|Cloud API|WABA/i)
  })

  it('con el límite bajo dice cuánto tiene hoy', () => {
    const copy = readinessCopy(readiness({ state: 'limit_too_low', messaging_limit: 'TIER_250', messaging_limit_ok: false }))
    expect(copy.body).toContain('(hoy: 250)')
  })

  it('no promete que las llamadas ya funcionan', () => {
    expect(readinessCopy(readiness()).body).toMatch(/próxima versión/)
  })
})

describe('canReceiveCallsPermission', () => {
  it.each([
    [user(), true],
    [user({ role: 'admin' }), true],
    [user({ role: 'analista' }), false],
    [user({ is_active: false }), false],
    [user({ is_active: false, invitation_pending: true }), true],
  ])('%#', (candidate, expected) => {
    expect(canReceiveCallsPermission(candidate)).toBe(expected)
  })
})
