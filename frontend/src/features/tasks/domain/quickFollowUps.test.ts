import { describe, expect, it } from 'vitest'
import { quickFollowUpDue } from './quickFollowUps'

describe('quickFollowUpDue', () => {
  const now = new Date(2026, 10, 4, 21, 37, 12)

  it('en 2 h redondea a los 5 minutos siguientes', () => {
    expect(quickFollowUpDue('in-2h', now)).toEqual(new Date(2026, 10, 4, 23, 40, 0))
  })

  it('los seguimientos por días caen a las 9 de la mañana', () => {
    expect(quickFollowUpDue('tomorrow', now)).toEqual(new Date(2026, 10, 5, 9, 0, 0))
    expect(quickFollowUpDue('in-3-days', now)).toEqual(new Date(2026, 10, 7, 9, 0, 0))
    expect(quickFollowUpDue('next-week', now)).toEqual(new Date(2026, 10, 11, 9, 0, 0))
  })
})
