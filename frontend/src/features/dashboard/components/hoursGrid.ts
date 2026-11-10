import type { DashboardHours } from '../types'

/** Qué se lee sobre la cuadrícula. Los conteos van como promedio por día de
 *  la semana; `engaged` es un porcentaje. */
export type HoursReading = 'conversations' | 'engaged' | 'flows_manual' | 'flows_automatic'

export const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

/** Con menos semanas, cada celda es una o dos muestras y se lee como patrón
 *  lo que es azar: el panel muestra un aviso en vez del mapa. */
export const MIN_DAYS_FOR_PATTERN = 28

/** Un 100 % con una sola conversación no significa nada: por debajo de esto
 *  la celda no muestra porcentaje. */
export const MIN_CASES_FOR_RATE = 5

export const LEVELS = 5

export interface HoursCell {
  /** null = muy pocos casos para un porcentaje. */
  value: number | null
  /** 0 = sin movimiento; 1…LEVELS = intensidad relativa al máximo. */
  level: number
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
  flows_manual: ['flujo a mano', 'flujos a mano'],
  flows_automatic: ['flujo automático', 'flujos automáticos'],
}

export function formatAverage(value: number): string {
  return value.toLocaleString('es-PE', { maximumFractionDigits: 1 })
}

function describe(reading: HoursReading, value: number | null): string {
  if (reading === 'engaged') {
    return value === null ? 'muy pocos casos para un porcentaje' : `${Math.round(value)} % siguió conversando`
  }
  const amount = value ?? 0
  const [one, many] = UNITS[reading]
  return `${formatAverage(amount)} ${formatAverage(amount) === '1' ? one : many} en promedio`
}

export function buildHoursGrid(hours: DashboardHours, reading: HoursReading): HoursGrid {
  const slotCount = Math.floor(24 / hours.slot_hours)
  const isRate = reading === 'engaged'
  const values: (number | null)[][] = WEEKDAYS.map(() => Array.from({ length: slotCount }, () => (isRate ? null : 0)))

  for (const cell of hours.cells) {
    if (cell.weekday < 0 || cell.weekday >= WEEKDAYS.length || cell.slot < 0 || cell.slot >= slotCount) continue
    if (isRate) {
      values[cell.weekday][cell.slot] = cell.settled >= MIN_CASES_FOR_RATE ? (cell.engaged / cell.settled) * 100 : null
    } else {
      // Promedio y no suma: un período con cinco lunes y cuatro martes haría
      // ver al lunes más cargado de lo que es.
      const occurrences = hours.weekday_occurrences[cell.weekday] ?? 0
      values[cell.weekday][cell.slot] = occurrences > 0 ? cell[reading] / occurrences : 0
    }
  }

  const max = Math.max(0, ...values.flat().map(value => value ?? 0))
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
          level: value === null || value <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((value / max) * LEVELS)),
          description: `${weekday} ${from}–${from + hours.slot_hours} h: ${describe(reading, value)}`,
        }
      }),
    })),
  }
}
