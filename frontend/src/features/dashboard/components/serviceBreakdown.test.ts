import { describe, expect, it } from 'vitest'
import type { DashboardMetrics, DashboardSales } from '../types'
import { OTHER_KEY, bucketDays, buildBuckets, fromAppointments, fromSales, headline, pickSeries, shares } from './serviceBreakdown'

function sales(overrides: Partial<DashboardSales>): DashboardSales {
  return {
    currency: 'PEN',
    totals: { count: 0, revenue: 0, avg_ticket: null, sessions: 0, discount: 0, discount_rate: null, buyers: 0 },
    previous: null,
    trend: [],
    previous_trend: [],
    by_package: [],
    by_service: [],
    by_service_daily: [],
    by_seller: [],
    recent: [],
    ...overrides,
  }
}

const days = (n: number) => Array.from({ length: n }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, count: 0, revenue: 0 }))
const service = (id: number, name: string, revenue: number) => ({ service_id: id, name, count: 1, revenue })

describe('pickSeries', () => {
  it('da color propio a los cinco que más ingresaron y agrupa el resto en Otros', () => {
    const data = sales({ by_service: [1, 2, 3, 4, 5, 6, 7].map((id) => service(id, `S${id}`, 100 - id)) })
    const series = pickSeries(fromSales(data))
    expect(series.map((item) => item.name)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'Otros'])
    expect(new Set(series.map((item) => item.color)).size).toBe(6)
  })

  it('no agrega Otros cuando no sobra ningún tratamiento', () => {
    expect(pickSeries(fromSales(sales({ by_service: [service(1, 'HIFU', 10)] }))).map((item) => item.key)).toEqual(['id:1'])
  })
})

describe('buildBuckets', () => {
  const data = sales({
    trend: days(10),
    by_service: [service(1, 'HIFU', 900), service(2, 'Hollywood Peel', 500), ...[3, 4, 5, 6].map((id) => service(id, `S${id}`, 10))],
    by_service_daily: [
      { date: '2026-10-01', service_id: 1, name: 'HIFU', count: 2, revenue: 600 },
      { date: '2026-10-04', service_id: 2, name: 'Hollywood Peel', count: 3, revenue: 500 },
      { date: '2026-10-10', service_id: 1, name: 'HIFU', count: 1, revenue: 300 },
      // El sexto tratamiento cae en Otros.
      { date: '2026-10-10', service_id: 6, name: 'S6', count: 4, revenue: 10 },
    ],
  })
  const source = fromSales(data)
  const series = pickSeries(source)

  it('cuenta las semanas desde hoy hacia atrás: solo la más vieja puede quedar corta', () => {
    const buckets = buildBuckets(source, series, 'count', 7)
    expect(buckets.map((bucket) => [bucket.start, bucket.end])).toEqual([
      ['2026-10-01', '2026-10-03'],
      ['2026-10-04', '2026-10-10'],
    ])
    expect(buckets.map((bucket) => bucket.partialDays)).toEqual([3, null])
    expect(buckets[0].values['id:1']).toBe(2)
    expect(buckets[1]).toMatchObject({ total: 8, values: { 'id:1': 1, 'id:2': 3, [OTHER_KEY]: 4 } })
  })

  it('suma ingresos cuando se pide esa medida', () => {
    const buckets = buildBuckets(source, series, 'revenue', 7)
    expect(buckets.map((bucket) => bucket.total)).toEqual([600, 810])
  })

  it('reparte el período en porcentajes con Otros al final', () => {
    const result = shares(buildBuckets(source, series, 'count', 1), series)
    expect(result.map((item) => [item.name, item.value, item.share])).toEqual([
      ['HIFU', 3, 30], ['Hollywood Peel', 3, 30], ['S3', 0, 0], ['S4', 0, 0], ['S5', 0, 0], ['Otros', 4, 40],
    ])
  })
})

describe('bucketDays', () => {
  it('muestra días en una semana y semanas en un mes o un trimestre', () => {
    expect([bucketDays(7), bucketDays(30), bucketDays(90)]).toEqual([1, 7, 7])
  })
})

describe('headline', () => {
  it('nombra al más vendido sin contar Otros y calla si no hubo ventas', () => {
    const series = [
      { key: OTHER_KEY, name: 'Otros', color: 'x', value: 9, share: 60 },
      { key: 'id:1', name: 'HIFU', color: 'y', value: 6, share: 40 },
    ]
    expect(headline(series, String)).toBe('HIFU fue el más vendido: 6, el 40% del período.')
    expect(headline([{ ...series[1], value: 0, share: 0 }], String)).toBeNull()
  })
})

describe('fromAppointments', () => {
  const metrics = {
    appointments: {
      trend: days(3).map(({ date }) => ({ date, value: 0 })),
      by_treatment_daily: [
        { date: '2026-10-01', key: 'hifu12d', name: 'Hifu12D', count: 3 },
        { date: '2026-10-02', key: 'hifu12d', name: 'HIFU 12D', count: 1 },
        { date: '2026-10-02', key: 'hollywoodpeelx3', name: 'Hollywood Peel x3', count: 2 },
      ],
    },
  } as unknown as DashboardMetrics

  it('ordena por cantidad y muestra la escritura que más se usó', () => {
    const source = fromAppointments(metrics)
    expect(source.ranking).toEqual([
      { key: 'hifu12d', name: 'Hifu12D', count: 4 },
      { key: 'hollywoodpeelx3', name: 'Hollywood Peel x3', count: 2 },
    ])
    expect(source.hasRevenue).toBe(false)
  })

  it('cuenta citas por día con la clave unificada', () => {
    const source = fromAppointments(metrics)
    const buckets = buildBuckets(source, pickSeries(source), 'count', 1)
    expect(buckets.map((bucket) => bucket.total)).toEqual([3, 3, 0])
    expect(headline(shares(buckets, pickSeries(source)), String, source.verb)).toBe('Hifu12D fue el más agendado: 4, el 67% del período.')
  })
})
