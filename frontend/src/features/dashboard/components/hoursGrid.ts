import type { DashboardHours } from '../types'

/** Qué se lee sobre la cuadrícula. Los conteos van como promedio por día de
 *  la semana; `engaged` es un porcentaje. */
export type HoursReading = 'conversations' | 'engaged' | 'flows_manual' | 'flows_automatic' | 'messages' | 'phone_messages'

export const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

/** Con menos semanas, cada celda es una o dos muestras y se lee como patrón
 *  lo que es azar: el panel muestra un aviso en vez del mapa. */
export const MIN_DAYS_FOR_PATTERN = 28

/** Un 100 % con una sola conversación no significa nada: por debajo de esto
 *  la celda no muestra porcentaje. */
export const MIN_CASES_FOR_RATE = 5

export const LEVELS = 5

// Un solo tono en degradado: la intensidad se lee sola y no compite con los
// colores de estado del resto del panel. El nivel 0 es el neutro del fondo.
// Vive acá y no en un componente porque lo comparten el mapa del equipo y el
// de cada persona: dos degradados distintos no se podrían comparar.
//
// En oscuro el vacío es casi el fondo del panel y el primer nivel sube a /30:
// con el gris de los campos de vacío y /15 de primer nivel, una franja con
// poco movimiento quedaba más oscura que una sin nada y se leía como un hueco.
export const LEVEL_CLASS = [
  'bg-wa-field dark:bg-white/5',
  'bg-wa-primary/15 dark:bg-wa-primary/30',
  'bg-wa-primary/35 dark:bg-wa-primary/45',
  'bg-wa-primary/55 dark:bg-wa-primary/60',
  'bg-wa-primary/80',
  'bg-wa-primary-strong dark:bg-wa-primary',
]

// Lo que sale por WhatsApp fuera del CRM va en el naranja que ya tiene ese
// origen en "Mensajes enviados por día": no es de una persona y se pinta con
// escala propia, así que no puede parecerse al degradado de las personas.
export const WHATSAPP_LEVEL_CLASS = [
  'bg-wa-field dark:bg-white/5',
  'bg-(--viz-cat-2)/20 dark:bg-(--viz-cat-2)/30',
  'bg-(--viz-cat-2)/40 dark:bg-(--viz-cat-2)/45',
  'bg-(--viz-cat-2)/60',
  'bg-(--viz-cat-2)/80',
  'bg-(--viz-cat-2)',
]

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
  messages: ['mensaje escrito en el CRM', 'mensajes escritos en el CRM'],
  phone_messages: ['mensaje desde WhatsApp', 'mensajes desde WhatsApp'],
}

export function formatAverage(value: number): string {
  return value.toLocaleString('es-PE', { maximumFractionDigits: 1 })
}

/** "4 mensajes escritos en el CRM", "1 flujo a mano". */
export function countPhrase(reading: Exclude<HoursReading, 'engaged'>, amount: number): string {
  const [one, many] = UNITS[reading]
  return `${formatAverage(amount)} ${formatAverage(amount) === '1' ? one : many}`
}

function describe(reading: HoursReading, value: number | null): string {
  if (reading === 'engaged') {
    return value === null ? 'muy pocos casos para un porcentaje' : `${Math.round(value)} % siguió conversando`
  }
  return `${countPhrase(reading, value ?? 0)} en promedio`
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
      // Promedio y no suma: un período con cinco lunes y cuatro martes haría
      // ver al lunes más cargado de lo que es.
      const occurrences = hours.weekday_occurrences[cell.weekday] ?? 0
      values[cell.weekday][cell.slot] = occurrences > 0 ? cell[reading] / occurrences : 0
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
          level: value === null || value <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((value / max) * LEVELS)),
          description: `${weekday} ${from}–${from + hours.slot_hours} h: ${describe(reading, value)}`,
        }
      }),
    })),
  }
}
