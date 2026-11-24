import { describe, expect, it } from 'vitest'
import { describeBusinessHours, isOpenAt } from './businessHours'
import type { BusinessDayHours } from './types'

const week = (open: Record<number, [string, string]>): BusinessDayHours[] => Array.from({ length: 7 }, (_, weekday) => ({
  weekday, open: weekday in open, start: open[weekday]?.[0] ?? '09:00', end: open[weekday]?.[1] ?? '13:00',
}))
const WEEKDAYS = week({ 0: ['08:00', '18:00'], 1: ['08:00', '18:00'], 2: ['08:00', '18:00'], 3: ['08:00', '18:00'], 4: ['08:00', '18:00'] })

describe('describeBusinessHours', () => {
  it('groups consecutive days with the same hours', () => {
    expect(describeBusinessHours(WEEKDAYS)).toBe('lun a vie 08:00–18:00')
    expect(describeBusinessHours(week({ 0: ['08:00', '18:00'], 1: ['08:00', '18:00'], 5: ['09:00', '13:00'] }))).toBe('lun a mar 08:00–18:00; sáb 09:00–13:00')
    expect(describeBusinessHours(WEEKDAYS, { short: false })).toBe('lunes a viernes 08:00–18:00')
  })

  it('says so when no day is open', () => {
    expect(describeBusinessHours(week({}))).toBe('sin días de atención')
  })
})

describe('isOpenAt', () => {
  // 2026-07-20 es lunes. 14:00 UTC son las 09:00 en Lima y las 23:00 en Tokio.
  const monday = new Date('2026-07-20T14:00:00Z')

  it('reads the moment in the business timezone, not the browser one', () => {
    expect(isOpenAt(WEEKDAYS, 'America/Lima', monday)).toBe(true)
    expect(isOpenAt(WEEKDAYS, 'Asia/Tokyo', monday)).toBe(false)
  })

  it('the closing time is already closed and a day without hours is closed', () => {
    expect(isOpenAt(WEEKDAYS, 'America/Lima', new Date('2026-07-20T22:59:00Z'))).toBe(true)
    expect(isOpenAt(WEEKDAYS, 'America/Lima', new Date('2026-07-20T23:00:00Z'))).toBe(false)
    // Sábado 25 a las 10:00 de Lima.
    expect(isOpenAt(WEEKDAYS, 'America/Lima', new Date('2026-07-25T15:00:00Z'))).toBe(false)
  })

  it('does not guess with a timezone the browser does not know', () => {
    expect(isOpenAt(WEEKDAYS, 'America/No_Existe', monday)).toBeNull()
  })
})
