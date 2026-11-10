/** Cálculos de la pestaña Ventas. Viven aparte de los componentes porque
 *  mezclar funciones con componentes en un archivo rompe el fast refresh. */
import type { DashboardAmountPoint } from '../types'

export type Direction = 'up' | 'down' | 'flat' | 'none'

export interface Change {
  direction: Direction
  /** Texto con flecha y signo: la dirección no depende solo del color. */
  label: string
}

/** Cambio porcentual contra la ventana anterior. Sin base no hay porcentaje:
 *  un "+100 %" sobre cero no dice nada. */
export function percentChange(current: number | null, previous: number | null | undefined): Change {
  if (current == null || !previous) return { direction: 'none', label: 'Sin período anterior' }
  const change = Math.round(((current - previous) / previous) * 100)
  if (change === 0) return { direction: 'flat', label: 'Igual' }
  return { direction: change > 0 ? 'up' : 'down', label: `${change > 0 ? '▲ +' : '▼ '}${change}%` }
}

export interface ComparedPoint {
  /** Fecha de inicio del tramo en el período actual. */
  date: string
  /** Fecha de inicio del mismo tramo en la ventana anterior. */
  previousDate: string
  /** Último día del tramo cuando agrupa una semana. */
  endDate?: string
  current: number
  previous: number
}

/** Une las dos series por posición (día 1 con día 1). Con 90 días agrupa por
 *  semana: 90 puntos diarios de una clínica chica son ruido, no tendencia. */
export function compareSeries(
  current: DashboardAmountPoint[],
  previous: DashboardAmountPoint[],
  metric: 'revenue' | 'count',
  bucketDays: number,
): ComparedPoint[] {
  const points: ComparedPoint[] = []
  for (let start = 0; start < current.length; start += bucketDays) {
    const slice = current.slice(start, start + bucketDays)
    const previousSlice = previous.slice(start, start + bucketDays)
    points.push({
      date: slice[0].date,
      previousDate: previousSlice[0]?.date ?? slice[0].date,
      endDate: bucketDays > 1 ? slice.at(-1)!.date : undefined,
      current: slice.reduce((sum, point) => sum + point[metric], 0),
      previous: previousSlice.reduce((sum, point) => sum + point[metric], 0),
    })
  }
  return points
}

/** Una docena de tramos para la sparkline, sin importar el largo del período. */
export function sparkSeries(points: DashboardAmountPoint[], metric: 'revenue' | 'count'): number[] {
  const size = Math.max(1, Math.ceil(points.length / 12))
  const values: number[] = []
  for (let start = 0; start < points.length; start += size) {
    values.push(points.slice(start, start + size).reduce((sum, point) => sum + point[metric], 0))
  }
  return values
}
