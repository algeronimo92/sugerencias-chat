import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeHolds,
  hasFreshForeignLease,
  hold,
  LEASE_FRESH_MS,
  LEASE_RENEW_MS,
  publishActivityLease,
  resetActivity,
  useActiveHolds,
  useActivityHold,
} from './activity'

describe('activity', () => {
  beforeEach(() => {
    resetActivity()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retiene y suelta por tipo, contando varias retenciones del mismo tipo', () => {
    const releaseA = hold('recording')
    const releaseB = hold('recording')
    const releaseC = hold('reply')
    expect(activeHolds()).toEqual(['recording', 'reply'])
    releaseA()
    expect(activeHolds()).toEqual(['recording', 'reply'])
    releaseB()
    releaseB()
    expect(activeHolds()).toEqual(['reply'])
    releaseC()
    expect(activeHolds()).toEqual([])
  })

  it('el hook retiene mientras está activo y avisa a quien observa', () => {
    const observer = renderHook(() => useActiveHolds())
    const holder = renderHook(({ active }) => useActivityHold('pending-media', active), { initialProps: { active: false } })
    expect(observer.result.current).toEqual([])
    holder.rerender({ active: true })
    expect(observer.result.current).toEqual(['pending-media'])
    holder.rerender({ active: false })
    expect(observer.result.current).toEqual([])
  })

  it('publica la marca de la pestaña mientras haya algo retenido y la borra al soltar', () => {
    vi.useFakeTimers()
    const stop = publishActivityLease()
    const ownKeys = () => Object.keys(localStorage).filter(key => key.startsWith('pwa-activity:'))
    expect(ownKeys()).toEqual([])

    const release = hold('selection')
    expect(ownKeys()).toHaveLength(1)
    const before = Number(localStorage.getItem(ownKeys()[0]))
    vi.advanceTimersByTime(LEASE_RENEW_MS)
    expect(Number(localStorage.getItem(ownKeys()[0]))).toBeGreaterThan(before)

    // La marca propia no cuenta como "otra pestaña".
    expect(hasFreshForeignLease()).toBe(false)

    release()
    expect(ownKeys()).toEqual([])
    stop()
  })

  it('detecta la marca fresca de otra pestaña y olvida las vencidas', () => {
    const now = Date.now()
    localStorage.setItem('pwa-activity:otra', String(now - LEASE_FRESH_MS + 1_000))
    expect(hasFreshForeignLease(now)).toBe(true)
    localStorage.setItem('pwa-activity:otra', String(now - LEASE_FRESH_MS - 1))
    expect(hasFreshForeignLease(now)).toBe(false)
    localStorage.setItem('pwa-activity:rota', 'no-es-fecha')
    expect(hasFreshForeignLease(now)).toBe(false)
  })

  it('al soltar en un orden distinto no se pierde ninguna cuenta', () => {
    const release = hold('flow-editor')
    act(() => release())
    expect(activeHolds()).toEqual([])
  })
})
