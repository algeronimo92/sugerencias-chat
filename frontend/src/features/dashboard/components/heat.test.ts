import { describe, expect, it } from 'vitest'
import { compactNumber, heatCell, intensityOf } from './heat'

describe('el color de una celda', () => {
  it('lo vacío es un neutro aparte y lo demás lleva su proporción exacta', () => {
    expect(heatCell(0).style).toBeUndefined()
    expect(heatCell(0.37)).toEqual({ className: 'heat-cell', style: { '--heat': 0.37 } })
    // Lo poco no puede confundirse con lo vacío: nunca cae al neutro.
    expect(heatCell(0.001).className).toBe('heat-cell')
  })

  it('nunca se sale de la escala', () => {
    expect(intensityOf(12, 10)).toBe(1)
    expect(intensityOf(null, 10)).toBe(0)
    expect(intensityOf(3, 0)).toBe(0)
  })
})

describe('el número dentro de la celda', () => {
  it('cabe en cuatro caracteres sin volver cero lo que es poco', () => {
    expect(compactNumber(0)).toBe('')
    // Una separación en trece semanas.
    expect(compactNumber(1 / 13)).toBe('0.08')
    expect(compactNumber(2.54)).toBe('2.5')
    expect(compactNumber(3)).toBe('3')
    expect(compactNumber(37.6)).toBe('38')
    expect(compactNumber(1234)).toBe('1.2k')
  })
})
