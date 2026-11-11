import type { DashboardMessagesByOrigin } from '../types'

export type MessageOrigin = 'app' | 'automation' | 'scheduled' | 'phone'

/** Orden fijo y color por origen: el color sigue al origen, no a su tamaño. */
export const MESSAGE_ORIGINS: { key: MessageOrigin; label: string; short: string; color: string }[] = [
  { key: 'app', label: 'Desde la app', short: 'App', color: 'var(--viz-cat-1)' },
  { key: 'phone', label: 'Desde el celular (fuera de la app)', short: 'Celular', color: 'var(--viz-cat-2)' },
  { key: 'automation', label: 'Flujos automáticos', short: 'Flujos', color: 'var(--viz-cat-3)' },
  { key: 'scheduled', label: 'Programados', short: 'Programados', color: 'var(--viz-cat-4)' },
]

export type OriginBucket = Record<MessageOrigin, number> & { date: string; end: string; total: number }

/** Junta los días en grupos de `size` (7 en la vista de 90 días). */
export function groupByOrigin(points: DashboardMessagesByOrigin[], size: number): OriginBucket[] {
  const buckets: OriginBucket[] = []
  for (let index = 0; index < points.length; index += size) {
    const slice = points.slice(index, index + size)
    const bucket: OriginBucket = { date: slice[0].date, end: slice.at(-1)!.date, app: 0, automation: 0, scheduled: 0, phone: 0, total: 0 }
    for (const point of slice) {
      for (const { key } of MESSAGE_ORIGINS) bucket[key] += point[key]
    }
    bucket.total = MESSAGE_ORIGINS.reduce((sum, { key }) => sum + bucket[key], 0)
    buckets.push(bucket)
  }
  return buckets
}

/** Total del período por origen y su porcentaje; los orígenes en cero no van. */
export function originShares(points: DashboardMessagesByOrigin[]) {
  const totals = MESSAGE_ORIGINS.map((origin) => ({ ...origin, value: points.reduce((sum, point) => sum + point[origin.key], 0) }))
  const total = totals.reduce((sum, item) => sum + item.value, 0)
  return totals
    .filter((item) => item.value > 0)
    .map((item) => ({ ...item, share: total ? Math.round((item.value / total) * 100) : 0 }))
}
