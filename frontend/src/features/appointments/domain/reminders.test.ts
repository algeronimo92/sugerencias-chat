import { describe, expect, it } from 'vitest'
import { describeOffset, joinOffset, nextOffset, offsetError, reminderState, splitOffset } from './reminders'

describe('anticipación de los recordatorios', () => {
  it('se edita en la unidad más grande que la expresa entera', () => {
    expect(splitOffset(1440)).toEqual({ amount: 1, unit: 'days' })
    expect(splitOffset(300)).toEqual({ amount: 5, unit: 'hours' })
    expect(splitOffset(90)).toEqual({ amount: 90, unit: 'minutes' })
    expect(joinOffset(2, 'days')).toBe(2880)
  })

  it('se lee como la escribe el equipo', () => {
    expect(describeOffset(1440)).toBe('1 día')
    expect(describeOffset(300)).toBe('5 horas')
    expect(describeOffset(90)).toBe('1 hora y 30 minutos')
  })

  it('no acepta anticipaciones fuera de rango ni repetidas', () => {
    expect(offsetError(10, [])).toBe('Entre 15 minutos y 7 días antes')
    expect(offsetError(60, [60])).toBe('Ya hay un recordatorio con esa anticipación')
    expect(offsetError(60, [1440])).toBeNull()
    expect(nextOffset([1440, 300, 60])).toBe(2880)
  })

  it('muestra lo último que se sabe del envío', () => {
    const base = { id: 1, offset_minutes: 60, starts_at: '', appointment_id: null, event_summary: '', recipient_name: '', reason: null, delivery_status: null, created_at: '' }
    expect(reminderState({ ...base, status: 'sent', delivery_status: 'read' }).label).toBe('Leído')
    expect(reminderState({ ...base, status: 'skipped', reason: 'El evento no trae un teléfono' }).label).toBe('No enviado')
  })
})
