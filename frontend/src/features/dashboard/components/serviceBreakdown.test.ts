import { describe, expect, it } from 'vitest'
import type { DashboardMetrics } from '../types'
import { OTHER_KEY, bucketDays, buildBuckets, fromAppointments, headline, pickSeries, shares } from './serviceBreakdown'

const days = (n: number) => Array.from({ length: n }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, value: 0 }))

function metrics(rows: DashboardMetrics['appointments']['by_treatment_daily'], period = 10): DashboardMetrics {
  return { appointments: { trend: days(period), by_treatment_daily: rows } } as unknown as DashboardMetrics
}

const row = (date: string, key: string, name: string, count: number, amount = 0) => ({ date, key, name, count, amount })

describe('pickSeries', () => {
  it('da color propio a los cinco con más separaciones y agrupa el resto en Otros', () => {
    const data = metrics([1, 2, 3, 4, 5, 6, 7].map((n) => row('2026-10-01', `t${n}`, `T${n}`, 10 - n)))
    const series = pickSeries(fromAppointments(data))
    expect(series.map((item) => item.name)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'Otros'])
    expect(new Set(series.map((item) => item.color)).size).toBe(6)
  })

  it('no agrega Otros cuando no sobra ningún tratamiento', () => {
    expect(pickSeries(fromAppointments(metrics([row('2026-10-01', 'hifu', 'HIFU', 1)]))).map((item) => item.key)).toEqual(['hifu'])
  })
})

describe('fromAppointments', () => {
  const data = metrics([
    row('2026-10-01', 'hifu12d', 'Hifu12D', 3, 300),
    row('2026-10-02', 'hifu12d', 'HIFU 12D', 1, 50),
    row('2026-10-02', 'hollywoodpeelx3', 'Hollywood Peel x3', 2, 100),
  ], 3)

  it('ordena por cantidad y muestra la escritura que más se usó', () => {
    const source = fromAppointments(data)
    expect(source.ranking).toEqual([
      { key: 'hifu12d', name: 'Hifu12D', count: 4 },
      { key: 'hollywoodpeelx3', name: 'Hollywood Peel x3', count: 2 },
    ])
    // El monto de una separación es su adelanto.
    expect(source.revenueLabel).toBe('Monto')
  })

  it('suma los adelantos como monto', () => {
    const source = fromAppointments(data)
    expect(buildBuckets(source, pickSeries(source), 'revenue', 1).map((bucket) => bucket.total)).toEqual([300, 150, 0])
  })

  it('cuenta separaciones por día con la clave unificada', () => {
    const source = fromAppointments(data)
    const buckets = buildBuckets(source, pickSeries(source), 'count', 1)
    expect(buckets.map((bucket) => bucket.total)).toEqual([3, 3, 0])
    expect(headline(shares(buckets, pickSeries(source)), String, source.verb)).toBe('Hifu12D fue el más separado: 4, el 67% del período.')
  })
})

describe('buildBuckets', () => {
  const data = metrics([
    row('2026-10-01', 'hifu', 'HIFU', 2),
    row('2026-10-04', 'hp', 'Hollywood Peel', 3),
    row('2026-10-10', 'hifu', 'HIFU', 1),
    ...['t3', 't4', 't5'].map((key) => row('2026-10-05', key, key.toUpperCase(), 1)),
    // Con seis tratamientos, el que menos separó cae en Otros.
    row('2026-10-10', 't6', 'T6', 4),
  ])
  const source = fromAppointments(data)
  const series = pickSeries(source)

  it('cuenta las semanas desde hoy hacia atrás: solo la más vieja puede quedar corta', () => {
    const buckets = buildBuckets(source, series, 'count', 7)
    expect(buckets.map((bucket) => [bucket.start, bucket.end])).toEqual([
      ['2026-10-01', '2026-10-03'],
      ['2026-10-04', '2026-10-10'],
    ])
    expect(buckets.map((bucket) => bucket.partialDays)).toEqual([3, null])
    expect(buckets[0].values.hifu).toBe(2)
    expect(buckets[1]).toMatchObject({ total: 11, values: { hifu: 1, hp: 3, t6: 4, [OTHER_KEY]: 1 } })
  })

  it('reparte el período en porcentajes con Otros al final', () => {
    const result = shares(buildBuckets(source, series, 'count', 1), series)
    expect(result.at(-1)?.name).toBe('Otros')
    expect(result.reduce((sum, item) => sum + item.value, 0)).toBe(13)
  })
})

describe('bucketDays', () => {
  it('muestra días en una semana y semanas en un mes o un trimestre', () => {
    expect([bucketDays(7), bucketDays(30), bucketDays(90)]).toEqual([1, 7, 7])
  })
})

describe('headline', () => {
  it('nombra al más separado sin contar Otros y calla si no hubo separaciones', () => {
    const series = [
      { key: OTHER_KEY, name: 'Otros', color: 'x', value: 9, share: 60 },
      { key: 'hifu', name: 'HIFU', color: 'y', value: 6, share: 40 },
    ]
    expect(headline(series, String, 'separado')).toBe('HIFU fue el más separado: 6, el 40% del período.')
    expect(headline([{ ...series[1], value: 0, share: 0 }], String)).toBeNull()
  })
})
