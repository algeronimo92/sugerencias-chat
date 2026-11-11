import { describe, expect, it } from 'vitest'
import type { DashboardHours, DashboardPersonHourCell } from '../types'
import { LEVELS } from './hoursGrid'
import { buildTeamHours } from './teamHours'

const cell = (weekday: number, slot: number, values: Partial<DashboardPersonHourCell> = {}): DashboardPersonHourCell => ({
  weekday, slot, messages: 0, flows_manual: 0, phone_messages: 0, ...values,
})

// Una semana que empieza en jueves: cada día de la semana cae una sola vez.
const WEEK: DashboardHours = {
  slot_hours: 2,
  engagement_window_hours: 24,
  weekday_occurrences: [1, 1, 1, 1, 1, 1, 1],
  start_date: '2026-11-05',
  person_peaks: { messages: 10, flows_manual: 2, phone_messages: 4 },
  cells: [],
  people: [
    { user_id: 2, name: 'Antonella', cells: [cell(3, 5, { messages: 2, phone_messages: 4 })] },
    { user_id: 3, name: 'Zoe', cells: [] },
    { user_id: 1, name: 'Grecia', cells: [cell(3, 5, { messages: 10 }), cell(2, 6, { messages: 5, flows_manual: 2 })] },
  ],
}

describe('el equipo por horas', () => {
  it('ordena de quien más hizo a quien menos y deja al final a quien no hizo nada', () => {
    const team = buildTeamHours(WEEK, 'messages')

    expect(team.people.map(person => [person.name, person.total])).toEqual([['Grecia', 15], ['Antonella', 2], ['Zoe', 0]])
    expect(team.people[2].rows.flatMap(row => row.cells).every(item => item.level === 0)).toBe(true)
  })

  it('el orden sigue a la lectura: quien atiende desde el celular sube al cambiarla', () => {
    expect(buildTeamHours(WEEK, 'phone_messages').people[0].name).toBe('Antonella')
  })

  it('pinta a todas contra el mismo tope: lo poco de una se ve más claro que lo mucho de otra', () => {
    const team = buildTeamHours(WEEK, 'messages')
    const level = (name: string) => {
      const person = team.people.find(item => item.name === name)!
      return Math.max(...person.rows.flatMap(row => row.cells.map(item => item.level)))
    }

    expect(team.max).toBe(10)
    expect(level('Grecia')).toBe(LEVELS)
    expect(level('Antonella')).toBe(1)
  })

  it('con una semana cada fila es una fecha, de la más vieja a hoy', () => {
    const team = buildTeamHours(WEEK, 'messages')
    const grecia = team.people[0]

    expect(team.dated).toBe(true)
    expect(grecia.rows.map(row => row.label)).toEqual(['Jue 5', 'Vie 6', 'Sáb 7', 'Dom 8', 'Lun 9', 'Mar 10', 'Mié 11'])
    // El jueves (weekday 3) es la primera fila; el miércoles (2), la última.
    expect(grecia.rows[0].cells[5].description).toMatch(/^Jue 5 nov\.?, 10–12 h: 10 mensajes escritos en el CRM$/)
    expect(grecia.rows[6].cells[6].value).toBe(5)
  })

  it('con un mes va de lunes a domingo y en promedio por día de la semana', () => {
    const month: DashboardHours = { ...WEEK, weekday_occurrences: [5, 5, 4, 4, 4, 4, 4], start_date: '2026-10-13' }
    const team = buildTeamHours(month, 'messages')
    const grecia = team.people[0]

    expect(team.dated).toBe(false)
    expect(grecia.rows.map(row => row.label)).toEqual(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'])
    expect(grecia.total).toBe(15)
    expect(grecia.rows[3].cells[5].description).toBe('Jue, 10–12 h: 2.5 mensajes escritos en el CRM en promedio')
  })

  it('sin la fecha de inicio (backend anterior) no inventa fechas', () => {
    const team = buildTeamHours({ ...WEEK, start_date: undefined }, 'messages')

    expect(team.dated).toBe(false)
    expect(team.people[0].rows[0].label).toBe('Lun')
  })
})
