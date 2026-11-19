import { describe, expect, it } from 'vitest'

import { DEFAULT_HOURS, canReceiveCallsPermission, hoursError, hoursFormFrom, hoursSlots, messagingLimitLabel, readinessCopy } from './callingReadiness'
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

  it('listo: manda a activarlas', () => {
    expect(readinessCopy(readiness()).body).toMatch(/actívalas abajo/)
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

describe('horario de llamadas', () => {
  it('va y vuelve del formato de Meta', () => {
    const slots = hoursSlots({ days: ['MONDAY', 'SATURDAY'], open: '09:30', close: '18:00' })
    expect(slots).toEqual([
      { day: 'MONDAY', open: '0930', close: '1800' },
      { day: 'SATURDAY', open: '0930', close: '1800' },
    ])
    expect(hoursFormFrom(slots)).toEqual({ days: ['MONDAY', 'SATURDAY'], open: '09:30', close: '18:00' })
    expect(hoursFormFrom([])).toEqual(DEFAULT_HOURS)
  })

  it('no acepta sin días ni con el cierre antes de la apertura', () => {
    expect(hoursError(DEFAULT_HOURS)).toBeNull()
    expect(hoursError({ ...DEFAULT_HOURS, days: [] })).toMatch(/un día/)
    expect(hoursError({ ...DEFAULT_HOURS, open: '19:00', close: '09:00' })).toMatch(/cierre/)
  })
})
