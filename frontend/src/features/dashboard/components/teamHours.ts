import type { DashboardHours } from '../types'
import { LEVELS, WEEKDAYS, countPhrase, type HoursCell } from './hoursGrid'

/** Lo que se sabe de cada persona por franja. */
export type PersonReading = 'messages' | 'flows_manual' | 'phone_messages'

export interface PersonHours {
  userId: number
  name: string
  /** Total del período para la lectura: un conteo, no un promedio. */
  total: number
  rows: { label: string; cells: HoursCell[] }[]
}

export interface TeamHours {
  slots: string[]
  /** Tope de color, el mismo para todas las personas. */
  max: number
  /** Cada fila es una fecha concreta (período de una semana) y no un día de
   *  la semana promediado. */
  dated: boolean
  people: PersonHours[]
}

interface Row {
  label: string
  /** Cómo se nombra el día en la frase de la celda. */
  spoken: string
  weekday: number
}

/**
 * Las filas de la cuadrícula.
 *
 * Con una semana cada día de la semana cae una sola vez: la fila "jueves" es
 * el jueves 5, y así se rotula y se ordena (del más viejo a hoy). Es lo que
 * responde "¿trabajaron esta semana?". Con 30 o 90 días una fila junta varios
 * jueves y se muestra de lunes a domingo, como promedio.
 */
function buildRows(hours: DashboardHours): { rows: Row[]; dated: boolean } {
  const days = hours.weekday_occurrences.reduce((sum, count) => sum + count, 0)
  const dated = Boolean(hours.start_date) && days > 0 && hours.weekday_occurrences.every(count => count <= 1)
  if (!dated) {
    return { dated, rows: WEEKDAYS.map((weekday, index) => ({ label: weekday, spoken: weekday, weekday: index })) }
  }
  const start = new Date(`${hours.start_date}T00:00:00`)
  const rows = Array.from({ length: days }, (_, offset) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset)
    // getDay() arranca en domingo; la cuadrícula, en lunes.
    const weekday = (date.getDay() + 6) % 7
    const spoken = `${WEEKDAYS[weekday]} ${date.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}`
    return { label: `${WEEKDAYS[weekday]} ${date.getDate()}`, spoken, weekday }
  })
  return { dated, rows }
}

/**
 * Una cuadrícula por persona, todas contra el mismo tope de color y ordenadas
 * de quien más hizo a quien menos. Las que no hicieron nada van igual, al
 * final y con la cuadrícula vacía: es justo lo que hay que poder ver.
 */
export function buildTeamHours(hours: DashboardHours, reading: PersonReading): TeamHours {
  const slotCount = Math.floor(24 / hours.slot_hours)
  const { rows, dated } = buildRows(hours)

  const people = (hours.people ?? []).map((person) => {
    const values = WEEKDAYS.map(() => Array.from({ length: slotCount }, () => 0))
    let total = 0
    for (const cell of person.cells) {
      if (cell.weekday < 0 || cell.weekday >= WEEKDAYS.length || cell.slot < 0 || cell.slot >= slotCount) continue
      total += cell[reading]
      // Promedio y no suma, igual que el mapa del equipo: un período con cinco
      // lunes haría ver al lunes más cargado de lo que es.
      const occurrences = hours.weekday_occurrences[cell.weekday] ?? 0
      values[cell.weekday][cell.slot] = occurrences > 0 ? cell[reading] / occurrences : 0
    }
    return { userId: person.user_id, name: person.name, total, values }
  })

  const ownMax = Math.max(0, ...people.flatMap(person => person.values.flat()))
  const max = Math.max(ownMax, hours.person_peaks?.[reading] ?? 0)

  return {
    slots: Array.from({ length: slotCount }, (_, slot) => `${slot * hours.slot_hours}`),
    max,
    dated,
    people: people
      .map(({ values, ...person }) => ({
        ...person,
        rows: rows.map(row => ({
          label: row.label,
          cells: values[row.weekday].map((value, slot) => {
            const from = slot * hours.slot_hours
            return {
              value,
              level: value <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((value / max) * LEVELS)),
              description: `${row.spoken}, ${from}–${from + hours.slot_hours} h: ${countPhrase(reading, value)}${dated ? '' : ' en promedio'}`,
            }
          }),
        })),
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'es')),
  }
}
