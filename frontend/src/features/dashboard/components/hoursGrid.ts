import type { DashboardHours } from '../types'
import { compactNumber, intensityOf } from './heat'

/** Qué se lee sobre la cuadrícula. Los conteos son el total del período en esa
 *  franja; `engaged` es un porcentaje. */
export type HoursReading = 'conversations' | 'engaged' | 'flows_manual' | 'flows_automatic' | 'messages' | 'phone_messages' | 'separations'

export const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

/** Con menos semanas, cada celda es una o dos muestras y se lee como patrón
 *  lo que es azar: el panel muestra un aviso en vez del mapa. */
export const MIN_DAYS_FOR_PATTERN = 28

/** Un 100 % con una sola conversación no significa nada: por debajo de esto
 *  la celda no muestra porcentaje. */
export const MIN_CASES_FOR_RATE = 5

export interface HoursCell {
  /** null = muy pocos casos para un porcentaje. */
  value: number | null
  /** 0 = sin movimiento; hasta 1 = proporción exacta del máximo. Es continua:
   *  con tramos, dos franjas distintas caían en el mismo tono. */
  intensity: number
  /** El número corto que va dentro de la celda; vacío si no hay nada que decir. */
  text: string
  /** Frase completa para el lector de pantalla, el tooltip y la lectura al tocar. */
  description: string
}

export interface HoursGrid {
  slots: string[]
  rows: { weekday: string; cells: HoursCell[] }[]
  max: number
  isRate: boolean
  hasData: boolean
}

const UNITS: Record<Exclude<HoursReading, 'engaged'>, [string, string]> = {
  conversations: ['conversación nueva', 'conversaciones nuevas'],
  flows_manual: ['automatización a mano', 'automatizaciones a mano'],
  flows_automatic: ['automatización que empezó sola', 'automatizaciones que empezaron solas'],
  messages: ['mensaje escrito en el CRM', 'mensajes escritos en el CRM'],
  phone_messages: ['mensaje desde WhatsApp', 'mensajes desde WhatsApp'],
  separations: ['separación registrada', 'separaciones registradas'],
}

export function formatAverage(value: number): string {
  return value.toLocaleString('es-PE', { maximumFractionDigits: 1 })
}

/** "4 mensajes escritos en el CRM", "1 flujo a mano". */
export function countPhrase(reading: Exclude<HoursReading, 'engaged'>, amount: number): string {
  const [one, many] = UNITS[reading]
  return `${formatAverage(amount)} ${formatAverage(amount) === '1' ? one : many}`
}

const WEEKDAYS_PLURAL = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'] as const

/**
 * "en 5 lunes": cuántos días de ese nombre juntó la celda.
 *
 * Las celdas llevan el total y no el promedio por día: "0.8 separaciones" se
 * leía como un porcentaje y nadie sabía de dónde salía. El costo es que en 30
 * días hay nombres de día que caen cinco veces y otros cuatro; se dice acá, en
 * la frase de la celda, para que quien compare dos días lo tenga a la vista.
 */
export function acrossDays(hours: DashboardHours, weekday: number): string {
  const occurrences = hours.weekday_occurrences[weekday] ?? 0
  if (occurrences <= 0) return ''
  return ` en ${occurrences} ${occurrences === 1 ? WEEKDAYS_PLURAL[weekday].replace(/os$/, 'o') : WEEKDAYS_PLURAL[weekday]}`
}

function describe(hours: DashboardHours, weekday: number, reading: HoursReading, value: number | null): string {
  if (reading === 'engaged') {
    return value === null ? 'muy pocos casos para un porcentaje' : `${Math.round(value)} % siguió conversando`
  }
  return `${countPhrase(reading, value ?? 0)}${acrossDays(hours, weekday)}`
}

/** Tope común del equipo para una lectura, si la lectura lo tiene. */
export function personPeak(hours: DashboardHours, reading: HoursReading): number | undefined {
  if (reading !== 'messages' && reading !== 'flows_manual') return undefined
  const peak = hours.person_peaks?.[reading]
  return peak && peak > 0 ? peak : undefined
}

/**
 * `scaleMax` fija el tope de color desde afuera. Sin él cada cuadrícula se
 * pinta contra su propio máximo, que sirve para ver el patrón de una semana
 * pero hace ver igual de intensas a dos personas que trabajan muy distinto.
 */
export function buildHoursGrid(hours: DashboardHours, reading: HoursReading, scaleMax?: number): HoursGrid {
  const slotCount = Math.floor(24 / hours.slot_hours)
  const isRate = reading === 'engaged'
  const values: (number | null)[][] = WEEKDAYS.map(() => Array.from({ length: slotCount }, () => (isRate ? null : 0)))

  for (const cell of hours.cells) {
    if (cell.weekday < 0 || cell.weekday >= WEEKDAYS.length || cell.slot < 0 || cell.slot >= slotCount) continue
    if (isRate) {
      values[cell.weekday][cell.slot] = cell.settled >= MIN_CASES_FOR_RATE ? (cell.engaged / cell.settled) * 100 : null
    } else {
      values[cell.weekday][cell.slot] = cell[reading]
    }
  }

  const ownMax = Math.max(0, ...values.flat().map(value => value ?? 0))
  // Nunca por debajo de lo propio: un tope desactualizado no puede sacar una
  // celda de la escala.
  const max = Math.max(ownMax, scaleMax ?? 0)
  const slots = Array.from({ length: slotCount }, (_, slot) => `${slot * hours.slot_hours}`)
  return {
    slots,
    max,
    isRate,
    hasData: values.flat().some(value => value !== null && value > 0),
    rows: WEEKDAYS.map((weekday, day) => ({
      weekday,
      cells: values[day].map((value, slot) => {
        const from = slot * hours.slot_hours
        return {
          value,
          intensity: intensityOf(value, max),
          // Un 0 % con casos suficientes es un dato y se escribe; un conteo en cero, no.
          text: value === null ? '' : isRate ? String(Math.round(value)) : compactNumber(value),
          description: `${weekday} ${from}–${from + hours.slot_hours} h: ${describe(hours, day, reading, value)}`,
        }
      }),
    })),
  }
}
