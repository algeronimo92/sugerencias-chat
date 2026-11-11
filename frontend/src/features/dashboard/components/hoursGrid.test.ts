/**
 * El mapa de horas engaña fácil: una suma hace ver más cargado al día que cayó
 * más veces en el período, y un porcentaje sobre dos casos parece un hallazgo.
 */
import { describe, expect, it } from 'vitest'
import type { DashboardHours } from '../types'
import { buildHoursGrid } from './hoursGrid'

function hours(cells: Partial<DashboardHours['cells'][number]>[]): DashboardHours {
  return {
    slot_hours: 2,
    engagement_window_hours: 24,
    // Cinco lunes y martes, cuatro del resto: un período de 30 días.
    weekday_occurrences: [5, 5, 4, 4, 4, 4, 4],
    cells: cells.map(cell => ({
      weekday: 0, slot: 0, conversations: 0, settled: 0, engaged: 0, flows_manual: 0, flows_automatic: 0, messages: 0, ...cell,
    })),
  }
}

describe('buildHoursGrid', () => {
  it('promedia por día de la semana en vez de sumar', () => {
    const grid = buildHoursGrid(hours([
      { weekday: 0, slot: 10, conversations: 10 },
      { weekday: 2, slot: 10, conversations: 10 },
    ]), 'conversations')

    // Mismas 10 conversaciones: el lunes cayó 5 veces y el miércoles 4.
    expect(grid.rows[0].cells[10].value).toBe(2)
    expect(grid.rows[2].cells[10].value).toBe(2.5)
    expect(grid.rows[2].cells[10].level).toBe(5)
    expect(grid.rows[0].cells[10].level).toBe(4)
    expect(grid.rows[0].cells[10].description).toBe('Lun 20–22 h: 2 conversaciones nuevas en promedio')
    expect(grid.slots).toHaveLength(12)
  })

  it('deja en neutro las celdas sin movimiento', () => {
    const grid = buildHoursGrid(hours([{ weekday: 0, slot: 4, flows_manual: 5 }]), 'flows_manual')

    expect(grid.rows[3].cells[0]).toMatchObject({ value: 0, level: 0 })
    expect(grid.rows[0].cells[4].description).toBe('Lun 8–10 h: 1 flujo a mano en promedio')
    expect(grid.hasData).toBe(true)
  })

  it('no saca porcentaje con muy pocos casos y usa solo las conversaciones con su ventana completa', () => {
    const grid = buildHoursGrid(hours([
      { weekday: 1, slot: 5, conversations: 2, settled: 2, engaged: 2 },
      { weekday: 1, slot: 6, conversations: 12, settled: 10, engaged: 4 },
    ]), 'engaged')

    expect(grid.rows[1].cells[5].value).toBeNull()
    expect(grid.rows[1].cells[5].description).toBe('Mar 10–12 h: muy pocos casos para un porcentaje')
    // 4 de 10, no 4 de 12: las dos de hoy todavía no tuvieron sus 24 h.
    expect(grid.rows[1].cells[6].value).toBe(40)
    expect(grid.rows[1].cells[6].description).toBe('Mar 12–14 h: 40 % siguió conversando')
    expect(grid.isRate).toBe(true)
  })

  it('avisa que no hay nada que dibujar', () => {
    expect(buildHoursGrid(hours([]), 'conversations').hasData).toBe(false)
  })
})
