import { describe, expect, it } from 'vitest'
import type { DashboardHourCell, DashboardHours, DashboardPersonHourCell } from '../types'
import { LEVELS } from './hoursGrid'
import { buildTeamHours, teamHeadline } from './teamHours'

const cell = (weekday: number, slot: number, values: Partial<DashboardPersonHourCell> = {}): DashboardPersonHourCell => ({
  weekday, slot, messages: 0, flows_manual: 0, ...values,
})

const whatsapp = (weekday: number, slot: number, phone_messages: number): DashboardHourCell => ({
  weekday, slot, phone_messages, conversations: 0, settled: 0, engaged: 0, flows_manual: 0, flows_automatic: 0, messages: 0,
})

// Una semana que empieza en jueves: cada día de la semana cae una sola vez.
const WEEK: DashboardHours = {
  slot_hours: 2,
  engagement_window_hours: 24,
  weekday_occurrences: [1, 1, 1, 1, 1, 1, 1],
  start_date: '2026-11-05',
  person_peaks: { messages: 10, flows_manual: 2 },
  // Lo de WhatsApp es del negocio entero: 300 mensajes contra 17 en el CRM.
  cells: [whatsapp(3, 5, 200), whatsapp(2, 6, 100)],
  people: [
    { user_id: 2, name: 'Antonella', cells: [cell(3, 5, { messages: 2 })] },
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
    expect(team.whatsapp!.rows[3].cells[5].description).toBe('Jue, 10–12 h: 50 mensajes en promedio, sin autor')
  })

  it('sin la fecha de inicio (backend anterior) no inventa fechas', () => {
    const team = buildTeamHours({ ...WEEK, start_date: undefined }, 'messages')

    expect(team.dated).toBe(false)
    expect(team.people[0].rows[0].label).toBe('Lun')
  })
})

// Antes se repartía por la vendedora asignada al chat y dos vendedoras salían
// casi idénticas: era el reparto de los chats, no quién escribió.
describe('lo que sale por WhatsApp fuera del CRM', () => {
  it('va como una fuente aparte, entera y con su propia escala', () => {
    const team = buildTeamHours(WEEK, 'messages')

    expect(team.whatsapp!.total).toBe(300)
    // No comparte tope con las personas: con el suyo (200) las dejaría en blanco.
    expect(team.whatsapp!.max).toBe(200)
    expect(team.max).toBe(10)
    expect(team.whatsapp!.rows[0].cells[5]).toMatchObject({ value: 200, level: LEVELS })
    expect(team.whatsapp!.rows[0].cells[5].description).toMatch(/^Jue 5 nov\.?, 10–12 h: 200 mensajes, sin autor$/)
    // Y no le suma a nadie.
    expect(team.people.reduce((sum, person) => sum + person.total, 0)).toBe(17)
  })

  it('no aparece al comparar flujos: no tiene nada que ver', () => {
    expect(buildTeamHours(WEEK, 'flows_manual').whatsapp).toBeNull()
  })
})

describe('el titular del panel', () => {
  it('dice dónde está el volumen: lo de WhatsApp sin autor y lo del CRM con nombres', () => {
    expect(teamHeadline(buildTeamHours(WEEK, 'messages'), 'messages')).toBe(
      '300 mensajes salieron por WhatsApp fuera del CRM, sin autor. 17 se escribieron en el CRM: Grecia 15, Antonella 2.',
    )
  })

  it('con mucha gente nombra a las primeras y resume el resto', () => {
    const people = ['Ana', 'Bea', 'Carla', 'Dora', 'Eva'].map((name, index) => ({
      user_id: index + 1, name, cells: [cell(0, 0, { messages: 10 - index })],
    }))
    const headline = teamHeadline(buildTeamHours({ ...WEEK, cells: [], people }, 'messages'), 'messages')

    expect(headline).toBe('40 se escribieron en el CRM: Ana 10, Bea 9, Carla 8, y 2 más.')
  })

  it('si nadie escribió en el CRM lo dice, sin esconder lo de WhatsApp', () => {
    const quiet = { ...WEEK, people: [{ user_id: 3, name: 'Zoe', cells: [] }] }

    expect(teamHeadline(buildTeamHours(quiet, 'messages'), 'messages')).toBe(
      '300 mensajes salieron por WhatsApp fuera del CRM, sin autor. Nadie escribió en el CRM.',
    )
  })

  it('en flujos solo cuenta lo iniciado a mano', () => {
    expect(teamHeadline(buildTeamHours(WEEK, 'flows_manual'), 'flows_manual')).toBe('2 flujos iniciados a mano: Grecia 2.')
    const none = { ...WEEK, people: [{ user_id: 3, name: 'Zoe', cells: [] }] }
    expect(teamHeadline(buildTeamHours(none, 'flows_manual'), 'flows_manual')).toBe('Nadie inició flujos a mano en el período.')
  })
})
