import { describe, expect, it } from 'vitest'

import type { CallPermission } from '../types'
import { callButtonState } from '../domain/callButtonState'

const permission = (overrides: Partial<CallPermission> = {}): CallPermission => ({
  status: 'none', expires_at: null, can_call: false, can_request: true, ...overrides,
})

describe('callButtonState', () => {
  it('con permiso temporal dice hasta cuándo, como fecha', () => {
    const state = callButtonState(permission({ status: 'temporary', can_call: true, expires_at: '2026-11-25T15:00:00Z' }), false)
    expect(state.canCall).toBe(true)
    expect(state.hint).toMatch(/hasta el 25 nov/)
  })

  it('con permiso permanente deja llamar', () => {
    expect(callButtonState(permission({ status: 'permanent', can_call: true }), false)).toMatchObject({ canCall: true, hint: 'Con permiso para llamar' })
  })

  it('sin permiso dice cómo pedirlo, o que ya se pidió', () => {
    expect(callButtonState(permission(), false)).toMatchObject({ canCall: false })
    expect(callButtonState(permission(), false).hint).toMatch(/Permiso de llamada/)
    expect(callButtonState(permission({ can_request: false }), false).hint).toMatch(/ya se le pidió/)
  })

  it('con permiso pero sin poder llamar, es el límite', () => {
    expect(callButtonState(permission({ status: 'temporary' }), false).hint).toMatch(/límite/)
  })

  it('mientras consulta o si Meta no responde no deja llamar', () => {
    expect(callButtonState(undefined, false)).toMatchObject({ canCall: false, hint: 'Consultando el permiso…' })
    expect(callButtonState(undefined, true).hint).toMatch(/reintentar/)
  })
})
