import { describe, expect, it } from 'vitest'
import { matchServices } from './knowledgeTemplateMatch'

const SERVICES = [
  { id: 1, name: 'Hollywood Peel - Rostro' },
  { id: 2, name: 'Hollywood Peel - Axilas' },
  { id: 3, name: 'Botox - 1 Zona' },
  { id: 4, name: 'Botox - 2 Zonas' },
  { id: 5, name: 'Peeling químico' },
  { id: 6, name: 'Borrado de Cejas' },
  { id: 7, name: 'Borrado de Tatuajes - L' },
  { id: 8, name: 'HIFU 12D - Rostro' },
]

describe('matchServices', () => {
  it('propone todas las zonas del tratamiento, no la de nombre más corto', () => {
    expect(matchServices('Hollywood Peel', SERVICES)).toEqual([1, 2])
    expect(matchServices('botox', SERVICES)).toEqual([3, 4])
  })

  it('compara por palabra completa: «Peel» no es «Hollywood Peel»', () => {
    expect(matchServices('Peel', SERVICES)).toEqual([])
    expect(matchServices('Peeling', SERVICES)).toEqual([5])
    // La familia entera sí: «HIFU» abarca «HIFU 12D - Rostro».
    expect(matchServices('HIFU', SERVICES)).toEqual([8])
  })

  it('una sugerencia con varios tratamientos los junta', () => {
    expect(matchServices('Borrado de Cejas · Borrado de Tatuajes', SERVICES)).toEqual([6, 7])
  })

  it('sin sugerencia, nada', () => {
    expect(matchServices(null, SERVICES)).toEqual([])
  })
})
