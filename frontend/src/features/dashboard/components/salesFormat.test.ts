import { describe, expect, it } from 'vitest'
import { compareSeries, isSunday, monthStartIn, percentChange, sparkSeries } from './salesFormat'

const day = (date: string, count: number, revenue: number) => ({ date, count, revenue })

describe('percentChange', () => {
  it('no inventa un porcentaje cuando no hay período anterior', () => {
    expect(percentChange(500, null)).toEqual({ direction: 'none', label: 'Sin período anterior' })
    expect(percentChange(500, 0).direction).toBe('none')
  })

  it('lleva flecha y signo para que la dirección no dependa del color', () => {
    expect(percentChange(150, 100)).toEqual({ direction: 'up', label: '▲ +50%' })
    expect(percentChange(80, 100)).toEqual({ direction: 'down', label: '▼ -20%' })
    expect(percentChange(100, 100)).toEqual({ direction: 'flat', label: 'Igual' })
  })
})

describe('compareSeries', () => {
  const current = Array.from({ length: 14 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, '0')}`, 1, 100))
  const previous = Array.from({ length: 14 }, (_, i) => day(`2026-09-${String(i + 17).padStart(2, '0')}`, 2, 50))

  it('alinea día con día cuando no agrupa', () => {
    const points = compareSeries(current, previous, 'revenue', 1)
    expect(points).toHaveLength(14)
    expect(points[0]).toMatchObject({ date: '2026-10-01', previousDate: '2026-09-17', current: 100, previous: 50 })
    expect(points[0].endDate).toBeUndefined()
  })

  it('suma por semana y deja el rango del tramo para el tooltip', () => {
    const points = compareSeries(current, previous, 'count', 7)
    expect(points).toEqual([
      { date: '2026-10-01', previousDate: '2026-09-17', endDate: '2026-10-07', current: 7, previous: 14 },
      { date: '2026-10-08', previousDate: '2026-09-24', endDate: '2026-10-14', current: 7, previous: 14 },
    ])
  })
})

describe('sparkSeries', () => {
  it('reduce cualquier período a una docena de tramos como mucho', () => {
    const points = Array.from({ length: 90 }, (_, i) => day(`d${i}`, 1, 10))
    const values = sparkSeries(points, 'revenue')
    expect(values.length).toBeLessThanOrEqual(12)
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(900)
  })
})

describe('isSunday', () => {
  it('reconoce el domingo por la fecha de calendario, sin correrse por la zona horaria', () => {
    expect(isSunday('2026-10-18')).toBe(true)
    expect(isSunday('2026-10-17')).toBe(false)
    expect(isSunday('2026-10-19')).toBe(false)
  })
})

describe('monthStartIn', () => {
  it('dice qué mes empieza dentro de una semana', () => {
    expect(monthStartIn('2026-10-29', '2026-11-04')).toBe('nov')
    expect(monthStartIn('2026-11-01', '2026-11-07')).toBe('nov')
    expect(monthStartIn('2026-11-02', '2026-11-08')).toBeNull()
    expect(monthStartIn('2026-12-28', '2027-01-03')).toBe('ene')
  })
})
