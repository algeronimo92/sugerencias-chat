import type { CSSProperties } from 'react'

/** De qué es el mapa: lo del CRM en el verde de marca, lo que salió por
 *  WhatsApp sin autor en su naranja. Los colores viven en index.css. */
export type HeatTone = 'crm' | 'whatsapp'

/** Va en el contenedor del mapa (o de su leyenda): fija los extremos del degradado. */
export const TONE_CLASS: Record<HeatTone, string> = { crm: '', whatsapp: 'heat-whatsapp' }

// "Sin nada" es un neutro aparte y no el arranque del degradado: una franja
// con poco movimiento tiene que distinguirse de una vacía. En oscuro es casi
// el fondo del panel, para que lo poco no quede más oscuro que lo vacío.
const EMPTY_CLASS = 'bg-wa-field text-wa-muted dark:bg-white/5 dark:text-wa-muted-dark'

/** Fondo (y tinta del número) de una celda según su intensidad, de 0 a 1. */
export function heatCell(intensity: number): { className: string; style?: CSSProperties } {
  if (intensity <= 0) return { className: EMPTY_CLASS }
  return { className: 'heat-cell', style: { '--heat': Math.min(1, intensity) } as CSSProperties }
}

/** Proporción del tope, para pintar. 0 solo cuando no hay nada. */
export function intensityOf(value: number | null, max: number): number {
  if (value === null || value <= 0 || max <= 0) return 0
  return Math.min(1, value / max)
}

/**
 * El número que cabe dentro de una celda de 26 px en un celular: como mucho
 * cuatro caracteres. Bajo 0,1 lleva dos decimales para que una separación en
 * trece semanas (0.08) no se lea como cero.
 */
export function compactNumber(value: number): string {
  if (value <= 0) return ''
  if (value >= 1000) return `${(value / 1000).toLocaleString('es-PE', { maximumFractionDigits: 1 })}k`
  if (value >= 10) return String(Math.round(value))
  return value.toLocaleString('es-PE', { maximumFractionDigits: value < 0.1 ? 2 : 1 })
}
