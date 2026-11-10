import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hold, LEASE_FRESH_MS, resetActivity, type ActivityKind } from '../shared/activity'
import { describeUpdateBlocker, updateBlocker } from './pwaUpdateGuard'

const HOLDS: ActivityKind[] = ['recording', 'pending-media', 'sending-media', 'reply', 'selection', 'flow-editor']

describe('updateBlocker', () => {
  beforeEach(() => {
    resetActivity()
    localStorage.clear()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('no bloquea cuando no hay nada a medias', () => {
    expect(updateBlocker({ pendingSends: 0 })).toBeNull()
  })

  it.each(HOLDS)('bloquea mientras %s esté retenido, y deja de bloquear al soltarlo', kind => {
    const release = hold(kind)
    expect(updateBlocker({ pendingSends: 0 })).toBe(kind)
    expect(describeUpdateBlocker(kind)).not.toHaveLength(0)
    release()
    expect(updateBlocker({ pendingSends: 0 })).toBeNull()
  })

  it('bloquea mientras haya un envío en vuelo', () => {
    expect(updateBlocker({ pendingSends: 1 })).toBe('sending')
  })

  it('bloquea mientras haya un diálogo abierto', () => {
    document.body.innerHTML = '<div role="dialog"></div>'
    expect(updateBlocker({ pendingSends: 0 })).toBe('dialog')
  })

  it('bloquea mientras otra pestaña tenga algo a medias', () => {
    const now = Date.now()
    localStorage.setItem('pwa-activity:otra', String(now - LEASE_FRESH_MS / 2))
    expect(updateBlocker({ pendingSends: 0, now })).toBe('other-tab')
  })

  it('cada motivo tiene un texto para la persona', () => {
    for (const blocker of [...HOLDS, 'sending', 'dialog', 'other-tab'] as const) {
      expect(describeUpdateBlocker(blocker)).toMatch(/\S/)
    }
  })
})
