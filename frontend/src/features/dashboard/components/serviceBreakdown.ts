/** Arma las series por tratamiento para las barras apiladas, las líneas y la
 *  torta. Vive aparte del componente por el fast refresh y para probarlo sin
 *  dibujar: Recharts no renderiza en jsdom. */
import type { DashboardSales } from '../types'

export type ServiceMetric = 'count' | 'revenue'

export interface ServiceSeries {
  key: string
  name: string
  /** Variable CSS: el color cambia solo con el tema. */
  color: string
}

export interface ServiceBucket {
  /** Primer y último día del tramo (iguales cuando es diario). */
  start: string
  end: string
  values: Record<string, number>
  total: number
  /** Tramo con menos días que el resto (solo el más viejo puede serlo): se
   *  avisa para que una barra corta no se lea como una caída. */
  partialDays: number | null
}

// Cinco tratamientos con color propio y el resto en "Otros": con más tonos la
// torta y las líneas dejan de distinguirse, sobre todo para daltónicos.
export const MAX_SERVICES = 5
export const OTHER_KEY = 'otros'
const COLORS = ['var(--viz-cat-1)', 'var(--viz-cat-2)', 'var(--viz-cat-3)', 'var(--viz-cat-4)', 'var(--viz-cat-5)']

function serviceKey(item: { service_id: number | null; name: string }): string {
  return item.service_id != null ? `id:${item.service_id}` : `nombre:${item.name}`
}

/** Los cinco que más ingresaron en el período, en ese orden. El color sigue al
 *  tratamiento y no a la métrica: cambiar de "Cantidad" a "Ingresos" no lo
 *  repinta, porque la elección siempre es por ingresos. */
export function pickSeries(sales: DashboardSales): ServiceSeries[] {
  const ranked = sales.by_service.slice(0, MAX_SERVICES).map((item, index) => ({
    key: serviceKey(item),
    name: item.name,
    color: COLORS[index],
  }))
  if (sales.by_service.length > MAX_SERVICES) {
    ranked.push({ key: OTHER_KEY, name: 'Otros', color: 'var(--viz-cat-other)' })
  }
  return ranked
}

/** Con 7 días, un tramo por día; con más, por semana contada desde hoy hacia
 *  atrás, así las semanas recientes quedan completas y solo la más vieja puede
 *  ser corta. */
export function bucketDays(days: number): number {
  return days <= 14 ? 1 : 7
}

export function buildBuckets(
  sales: DashboardSales,
  series: ServiceSeries[],
  metric: ServiceMetric,
  size: number,
): ServiceBucket[] {
  const days = sales.trend.map((point) => point.date)
  const known = new Set(series.map((item) => item.key))
  const byDay = new Map<string, Record<string, number>>()
  for (const row of sales.by_service_daily) {
    const key = known.has(serviceKey(row)) ? serviceKey(row) : OTHER_KEY
    const values = byDay.get(row.date) ?? {}
    values[key] = (values[key] ?? 0) + row[metric]
    byDay.set(row.date, values)
  }

  const buckets: ServiceBucket[] = []
  for (let end = days.length; end > 0; end -= size) {
    const slice = days.slice(Math.max(0, end - size), end)
    const values: Record<string, number> = Object.fromEntries(series.map((item) => [item.key, 0]))
    for (const day of slice) {
      for (const [key, value] of Object.entries(byDay.get(day) ?? {})) values[key] = (values[key] ?? 0) + value
    }
    buckets.unshift({
      start: slice[0],
      end: slice.at(-1)!,
      values,
      total: Object.values(values).reduce((sum, value) => sum + value, 0),
      partialDays: slice.length < size ? slice.length : null,
    })
  }
  return buckets
}

export interface ServiceShare extends ServiceSeries {
  value: number
  /** Porcentaje entero del total del período. */
  share: number
}

export function shares(buckets: ServiceBucket[], series: ServiceSeries[]): ServiceShare[] {
  const totals = series.map((item) => ({
    ...item,
    value: buckets.reduce((sum, bucket) => sum + (bucket.values[item.key] ?? 0), 0),
  }))
  const total = totals.reduce((sum, item) => sum + item.value, 0)
  return totals
    .map((item) => ({ ...item, share: total ? Math.round((item.value / total) * 100) : 0 }))
    // "Otros" va siempre al final: no es un tratamiento que compita con los demás.
    .sort((a, b) => Number(a.key === OTHER_KEY) - Number(b.key === OTHER_KEY) || b.value - a.value)
}

/** Frase que resume el reparto, para quien no lee gráficos. */
export function headline(items: ServiceShare[], format: (value: number) => string): string | null {
  const top = items.find((item) => item.key !== OTHER_KEY && item.value > 0)
  if (!top) return null
  return `${top.name} fue el más vendido: ${format(top.value)}, el ${top.share}% del período.`
}
