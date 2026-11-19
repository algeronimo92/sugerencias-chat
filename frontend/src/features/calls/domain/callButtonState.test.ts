import { describe, expect, it } from 'vitest'

import type { CallPermission } from '../types'
import { callButtonState } from './callButtonState'

const permission = (overrides: Partial<CallPermission> = {}): CallPermission => ({
  status: 'none', expires_at: null, can_call: false, can_request: true, unanswered_streak: 0,
  calls_left_before_losing_permission: null, ...overrides,
})

describe('callButtonState', () => {
  it('con permiso temporal dice hasta cuándo, como fecha', () => {
    const state = callButtonState(permission({ status: 'temporary', can_call: true, expires_at: '2026-11-25T15:00:00Z' }), false)
    expect(state.action).toBe('call')
    expect(state.hint).toMatch(/hasta el 25 nov/)
  })

  it('con permiso permanente deja llamar', () => {
    expect(callButtonState(permission({ status: 'permanent', can_call: true }), false)).toEqual({ action: 'call', hint: 'Llamar. Con permiso para llamar' })
  })

  it('tras dos llamadas sin contestar avisa cuántas quedan antes de perder el permiso', () => {
    const two = callButtonState(permission({ status: 'permanent', can_call: true, unanswered_streak: 2, calls_left_before_losing_permission: 2 }), false)
    expect(two.hint).toMatch(/2 veces más, perderás el permiso/)
    const three = callButtonState(permission({ status: 'permanent', can_call: true, unanswered_streak: 3, calls_left_before_losing_permission: 1 }), false)
    expect(three.hint).toMatch(/una vez más/)
  })

  it('sin permiso ofrece pedirlo, o dice que ya se pidió', () => {
    expect(callButtonState(permission(), false).action).toBe('request')
    expect(callButtonState(permission({ can_request: false }), false)).toMatchObject({ action: 'none' })
    expect(callButtonState(permission({ can_request: false }), false).hint).toMatch(/ya se le pidió/)
  })

  it('con permiso pero sin poder llamar, es el límite', () => {
    expect(callButtonState(permission({ status: 'temporary' }), false)).toMatchObject({ action: 'none' })
    expect(callButtonState(permission({ status: 'temporary' }), false).hint).toMatch(/límite/)
  })

  it('mientras consulta no hace nada; si Meta no responde, reintenta', () => {
    expect(callButtonState(undefined, false)).toEqual({ action: 'none', hint: 'Consultando el permiso…' })
    expect(callButtonState(undefined, true).action).toBe('retry')
  })
})
