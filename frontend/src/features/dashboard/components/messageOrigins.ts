import type { DashboardMessagesByOrigin } from '../types'

export type MessageOrigin = 'app' | 'automation' | 'scheduled' | 'phone'

/**
 * Orden fijo y color por origen: el color sigue al origen, no a su tamaño.
 *
 * Los nombres dicen "CRM" y "WhatsApp", no "la app" y "el celular": "la app"
 * se leía como la app de WhatsApp, y lo de fuera también sale de WhatsApp Web.
 * `hint` explica cada origen donde hay lugar (la lista junto a la torta);
 * "Programados" sonaba a campaña y por eso aclara que va a un solo chat.
 */
export const MESSAGE_ORIGINS: { key: MessageOrigin; label: string; short: string; phrase: string; color: string }[] = [
  {
    key: 'app', label: 'Escritos en el CRM', short: 'CRM', color: 'var(--viz-cat-1)',
    phrase: 'se escribió en el CRM',
  },
  {
    key: 'phone', label: 'Desde WhatsApp, fuera del CRM', short: 'WhatsApp', color: 'var(--viz-cat-2)',
    phrase: 'salió desde WhatsApp por fuera del CRM',
  },
  {
    key: 'automation', label: 'Flujos automáticos', short: 'Flujos', color: 'var(--viz-cat-3)',
    phrase: 'lo mandaron los flujos automáticos',
  },
  {
    key: 'scheduled', label: 'Programados en el CRM', short: 'Programados', color: 'var(--viz-cat-4)',
    phrase: 'eran mensajes programados',
  },
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

/** Alto mínimo con que se dibuja un origen que tuvo mensajes, y el hueco que lo
 *  separa del de arriba. */
export const MIN_SEGMENT_PX = 5
export const SEGMENT_GAP_PX = 2

/**
 * Dónde se dibuja el segmento de un origen dentro de su barra apilada.
 *
 * Los mensajes escritos en el CRM son el 2% del total: en un eje que llega a
 * 1600, los 13 de un día miden menos de 2px. El borde que separaba los
 * segmentos los tapaba enteros y la barra de ese día no mostraba el color,
 * aunque el tooltip sí los contaba (alguien mandó un mensaje, vio subir el
 * ranking por persona y no lo encontró acá). Por eso todo origen con mensajes
 * ocupa al menos `MIN_SEGMENT_PX` y empuja hacia arriba a los que tiene encima,
 * en vez de pisarse con ellos; la separación es un hueco y no un borde.
 *
 * `y` y `height` son los del segmento según la escala del gráfico; `order` es
 * el orden de apilado, de abajo hacia arriba.
 */
export function segmentBox(
  counts: Record<MessageOrigin, number>,
  key: MessageOrigin,
  order: MessageOrigin[],
  { y, height }: { y: number; height: number },
): { y: number; height: number } | null {
  const value = counts[key]
  if (!(value > 0) || !(height > 0)) return null
  const pxPerMessage = height / value
  const drawn = (count: number) => (count > 0 ? Math.max(count * pxPerMessage, MIN_SEGMENT_PX) : 0)
  const below = order.slice(0, order.indexOf(key))
  const baseline = y + height + below.reduce((sum, origin) => sum + counts[origin] * pxPerMessage, 0)
  const bottom = baseline - below.reduce((sum, origin) => sum + drawn(counts[origin]), 0)
  const full = drawn(value)
  return { y: bottom - full + SEGMENT_GAP_PX, height: full - SEGMENT_GAP_PX }
}

/** Total del período por origen y su porcentaje; los orígenes en cero no van. */
export function originShares(points: DashboardMessagesByOrigin[]) {
  const totals = MESSAGE_ORIGINS.map((origin) => ({ ...origin, value: points.reduce((sum, point) => sum + point[origin.key], 0) }))
  const total = totals.reduce((sum, item) => sum + item.value, 0)
  return totals
    .filter((item) => item.value > 0)
    .map((item) => ({ ...item, share: total ? Math.round((item.value / total) * 100) : 0 }))
}

/** "1,2 y 3" en castellano. */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`
}

/** El titular del panel: el total y qué parte fue cada origen, en palabras. */
export function originHeadline(total: string, shares: ReturnType<typeof originShares>): string {
  const parts = shares.map((item) => (item.share < 1 ? `menos del 1% ${item.phrase}` : `el ${item.share}% ${item.phrase}`))
  return `${total} mensajes del negocio: ${joinList(parts)}.`
}
