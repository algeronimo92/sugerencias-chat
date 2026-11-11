import type { DashboardHours } from '../types'
import { formatNumber } from './format'
import { LEVELS, WEEKDAYS, countPhrase, formatAverage, type HoursCell } from './hoursGrid'

/** Lo que se sabe de cada persona por franja: las dos cosas llevan autor. */
export type PersonReading = 'messages' | 'flows_manual'

export interface HoursRow {
  label: string
  cells: HoursCell[]
}

export interface PersonHours {
  userId: number
  name: string
  /** Total del período para la lectura: un conteo, no un promedio. */
  total: number
  rows: HoursRow[]
}

/**
 * Lo que salió por WhatsApp sin pasar por el CRM, del negocio entero.
 *
 * No es de nadie: esos mensajes llegan sin autor. Antes se repartían por la
 * vendedora asignada al chat y dos vendedoras salían casi idénticas (1,176 y
 * 1,132 en una semana): se veía cómo se reparten los chats, no quién escribió.
 * Va como una fuente más, con su propio tope de color, porque es veinte veces
 * lo escrito en el CRM y con la escala de las personas las dejaría en blanco.
 */
export interface WhatsappHours {
  total: number
  max: number
  rows: HoursRow[]
}

export interface TeamHours {
  slots: string[]
  /** Tope de color, el mismo para todas las personas. */
  max: number
  /** Cada fila es una fecha concreta (período de una semana) y no un día de
   *  la semana promediado. */
  dated: boolean
  people: PersonHours[]
  /** Solo al comparar mensajes: con los flujos no tiene nada que ver. */
  whatsapp: WhatsappHours | null
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

/** Conteos por día de la semana y franja, como promedio por las veces que
 *  cayó ese día: un período con cinco lunes haría ver al lunes más cargado. */
function averaged<Cell extends { weekday: number; slot: number }>(
  hours: DashboardHours, cells: Cell[], count: (cell: Cell) => number,
): { values: number[][]; total: number } {
  const slotCount = Math.floor(24 / hours.slot_hours)
  const values = WEEKDAYS.map(() => Array.from({ length: slotCount }, () => 0))
  let total = 0
  for (const cell of cells) {
    if (cell.weekday < 0 || cell.weekday >= WEEKDAYS.length || cell.slot < 0 || cell.slot >= slotCount) continue
    total += count(cell)
    const occurrences = hours.weekday_occurrences[cell.weekday] ?? 0
    values[cell.weekday][cell.slot] = occurrences > 0 ? count(cell) / occurrences : 0
  }
  return { values, total }
}

function toRows(
  hours: DashboardHours, rows: Row[], values: number[][], max: number, describe: (value: number) => string,
): HoursRow[] {
  return rows.map(row => ({
    label: row.label,
    cells: values[row.weekday].map((value, slot) => {
      const from = slot * hours.slot_hours
      return {
        value,
        level: value <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((value / max) * LEVELS)),
        description: `${row.spoken}, ${from}–${from + hours.slot_hours} h: ${describe(value)}`,
      }
    }),
  }))
}

/**
 * Una cuadrícula por persona, todas contra el mismo tope de color y ordenadas
 * de quien más hizo a quien menos. Las que no hicieron nada van igual, al
 * final y con la cuadrícula vacía: es justo lo que hay que poder ver. Al
 * comparar mensajes se suma, aparte, lo que salió por WhatsApp sin autor.
 */
export function buildTeamHours(hours: DashboardHours, reading: PersonReading): TeamHours {
  const slotCount = Math.floor(24 / hours.slot_hours)
  const { rows, dated } = buildRows(hours)
  const suffix = dated ? '' : ' en promedio'

  const people = (hours.people ?? []).map(person => ({
    userId: person.user_id,
    name: person.name,
    ...averaged(hours, person.cells, cell => cell[reading]),
  }))
  const ownMax = Math.max(0, ...people.flatMap(person => person.values.flat()))
  const max = Math.max(ownMax, hours.person_peaks?.[reading] ?? 0)

  let whatsapp: WhatsappHours | null = null
  if (reading === 'messages') {
    const { values, total } = averaged(hours, hours.cells, cell => cell.phone_messages ?? 0)
    const whatsappMax = Math.max(0, ...values.flat())
    whatsapp = {
      total,
      max: whatsappMax,
      rows: toRows(hours, rows, values, whatsappMax, value =>
        `${formatAverage(value)} ${formatAverage(value) === '1' ? 'mensaje' : 'mensajes'}${suffix}, sin autor`),
    }
  }

  return {
    slots: Array.from({ length: slotCount }, (_, slot) => `${slot * hours.slot_hours}`),
    max,
    dated,
    whatsapp,
    people: people
      .map(({ values, ...person }) => ({
        ...person,
        rows: toRows(hours, rows, values, max, value => `${countPhrase(reading, value)}${suffix}`),
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'es')),
  }
}

/** Cuántas personas se nombran en el titular antes de resumir con "y N más". */
const HEADLINE_NAMES = 3

/**
 * El titular del panel: dónde está el volumen, en una frase.
 *
 * Los colores comparan a las personas entre sí; contra WhatsApp no se puede
 * (escala propia), así que esa comparación va en números.
 */
export function teamHeadline(team: TeamHours, reading: PersonReading): string {
  const active = team.people.filter(person => person.total > 0)
  const total = active.reduce((sum, person) => sum + person.total, 0)
  const named = active.slice(0, HEADLINE_NAMES).map(person => `${person.name} ${formatNumber(person.total)}`)
  if (active.length > HEADLINE_NAMES) named.push(`y ${active.length - HEADLINE_NAMES} más`)
  const names = named.join(', ')

  if (reading === 'flows_manual') {
    if (total === 0) return 'Nadie inició flujos a mano en el período.'
    return `${formatNumber(total)} ${total === 1 ? 'flujo iniciado' : 'flujos iniciados'} a mano: ${names}.`
  }

  const outside = team.whatsapp?.total ?? 0
  const parts: string[] = []
  if (outside > 0) {
    parts.push(`${formatNumber(outside)} ${outside === 1 ? 'mensaje salió' : 'mensajes salieron'} por WhatsApp fuera del CRM, sin autor.`)
  }
  parts.push(total === 0
    ? 'Nadie escribió en el CRM.'
    : `${formatNumber(total)} se ${total === 1 ? 'escribió' : 'escribieron'} en el CRM: ${names}.`)
  return parts.join(' ')
}
