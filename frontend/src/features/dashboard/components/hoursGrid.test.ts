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
      weekday: 0, slot: 0, conversations: 0, settled: 0, engaged: 0, flows_manual: 0, flows_automatic: 0, messages: 0, phone_messages: 0, separations: 0, ...cell,
    })),
  }
}

describe('buildHoursGrid', () => {
  it('cada celda es el total del período y dice en cuántos días se juntó', () => {
    const grid = buildHoursGrid(hours([
      { weekday: 0, slot: 10, conversations: 10 },
      { weekday: 2, slot: 10, conversations: 10 },
    ]), 'conversations')

    // Mismas 10 conversaciones: valen igual aunque el lunes cayó 5 veces y el
    // miércoles 4. La diferencia se dice en la frase, no se esconde en un promedio.
    expect(grid.rows[0].cells[10]).toMatchObject({ value: 10, intensity: 1, text: '10' })
    expect(grid.rows[2].cells[10]).toMatchObject({ value: 10, intensity: 1, text: '10' })
    expect(grid.rows[0].cells[10].description).toBe('Lun 20–22 h: 10 conversaciones nuevas en 5 lunes')
    expect(grid.rows[2].cells[10].description).toBe('Mié 20–22 h: 10 conversaciones nuevas en 4 miércoles')
    expect(grid.slots).toHaveLength(12)
  })

  it('deja en neutro las celdas sin movimiento', () => {
    const grid = buildHoursGrid(hours([{ weekday: 0, slot: 4, flows_manual: 5 }]), 'flows_manual')

    expect(grid.rows[3].cells[0]).toMatchObject({ value: 0, intensity: 0, text: '' })
    expect(grid.rows[0].cells[4].description).toBe('Lun 8–10 h: 5 flujos a mano en 5 lunes')
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
    expect(grid.rows[1].cells[5].text).toBe('')
    expect(grid.rows[1].cells[6].value).toBe(40)
    expect(grid.rows[1].cells[6].text).toBe('40')
    expect(grid.rows[1].cells[6].description).toBe('Mar 12–14 h: 40 % siguió conversando')
    expect(grid.isRate).toBe(true)
  })

  it('con un tope común, la misma cantidad se pinta igual en el mapa de cualquier persona', () => {
    // Antonella escribió 8 en su franja más cargada; la que más escribe del equipo, 40.
    const own = buildHoursGrid(hours([{ weekday: 2, slot: 5, messages: 8 }]), 'messages')
    const shared = buildHoursGrid(hours([{ weekday: 2, slot: 5, messages: 8 }]), 'messages', 40)

    expect(own.rows[2].cells[5].intensity).toBe(1)
    expect(shared.rows[2].cells[5].intensity).toBeCloseTo(0.2)
    expect(shared.max).toBe(40)
    expect(shared.rows[2].cells[5].description).toBe('Mié 10–12 h: 8 mensajes escritos en el CRM en 4 miércoles')
  })

  it('un tope menor que lo propio no saca ninguna celda de la escala', () => {
    const grid = buildHoursGrid(hours([{ weekday: 2, slot: 5, messages: 8 }]), 'messages', 1)

    expect(grid.max).toBe(8)
    expect(grid.rows[2].cells[5].intensity).toBe(1)
  })

  it('dos franjas parecidas ya no caen en el mismo tono', () => {
    // 41 y 60 contra un tope de 100: con cinco tramos las dos eran "el tercero".
    const grid = buildHoursGrid(hours([
      { weekday: 2, slot: 1, separations: 100 },
      { weekday: 2, slot: 2, separations: 60 },
      { weekday: 2, slot: 3, separations: 41 },
    ]), 'separations')

    expect(grid.rows[2].cells[2].intensity).toBeCloseTo(0.6)
    expect(grid.rows[2].cells[3].intensity).toBeCloseTo(0.41)
    expect(grid.rows[2].cells[3].text).toBe('41')
  })

  it('avisa que no hay nada que dibujar', () => {
    expect(buildHoursGrid(hours([]), 'conversations').hasData).toBe(false)
  })
})
