import { describe, expect, it } from 'vitest'
import { submitLabel } from './submitLabel'

describe('submitLabel', () => {
  it('muestra el monto del adelanto en la moneda del negocio', () => {
    expect(submitLabel('50', 'PEN', true)).toMatch(/^Separar cita · S\/\s?50\.00$/)
    expect(submitLabel(14.5, 'PEN', true)).toMatch(/S\/\s?14\.50$/)
  })

  it('avisa cuando se separa sin adelanto', () => {
    expect(submitLabel('', 'PEN', true)).toBe('Separar sin adelanto')
    expect(submitLabel('0', 'PEN', true)).toBe('Separar sin adelanto')
  })

  it('sin campo de adelanto en el negocio solo dice separar', () => {
    expect(submitLabel(undefined, 'PEN', false)).toBe('Separar cita')
  })
})
