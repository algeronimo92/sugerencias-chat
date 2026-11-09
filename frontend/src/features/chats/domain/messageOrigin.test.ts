import { describe, expect, it } from 'vitest'

import { originGroupKey, originLabel } from './messageOrigin'

const FLOWS = new Map([[63802, 'Hollywood peel']])

describe('originLabel', () => {
  it('firma con el nombre de la persona que envió desde la app', () => {
    expect(originLabel({ kind: 'user', user_id: 7, user_name: 'Grecia Geronimo', execution_id: null }, FLOWS))
      .toBe('Grecia Geronimo')
  })

  it('no inventa nada para un envío viejo de la app sin persona', () => {
    expect(originLabel({ kind: 'user', user_id: null, user_name: null, execution_id: null }, FLOWS)).toBeNull()
  })

  it('nombra el flujo cuando la ejecución está cargada', () => {
    expect(originLabel({ kind: 'automation', user_id: null, user_name: null, execution_id: 63802 }, FLOWS))
      .toBe('Flujo Hollywood peel')
  })

  it('dice "Automatización" si la ejecución ya no está entre las cargadas', () => {
    expect(originLabel({ kind: 'automation', user_id: null, user_name: null, execution_id: 1 }, FLOWS))
      .toBe('Automatización')
  })

  it('acredita un programado a quien lo programó', () => {
    expect(originLabel({ kind: 'scheduled', user_id: 9, user_name: 'Antonella', execution_id: null }, FLOWS))
      .toBe('Programado · Antonella')
  })

  it('marca lo que no pasó por la app sin afirmar de dónde salió', () => {
    expect(originLabel({ kind: 'echo', user_id: null, user_name: null, execution_id: null }, FLOWS))
      .toBe('Fuera de la app')
  })

  it('no etiqueta mensajes del cliente', () => {
    expect(originLabel(null, FLOWS)).toBeNull()
  })
})

describe('originGroupKey', () => {
  it('separa lo que mandó una persona de lo que mandó el flujo que lanzó', () => {
    const person = originGroupKey({ sender: 'vendedor', origin: { kind: 'user', user_id: 7, user_name: 'Grecia', execution_id: null } })
    const flow = originGroupKey({ sender: 'vendedor', origin: { kind: 'automation', user_id: null, user_name: null, execution_id: 63802 } })
    expect(person).not.toBe(flow)
  })

  it('agrupa dos envíos seguidos de la misma persona', () => {
    const a = originGroupKey({ sender: 'vendedor', origin: { kind: 'user', user_id: 7, user_name: 'Grecia', execution_id: null } })
    const b = originGroupKey({ sender: 'vendedor', origin: { kind: 'user', user_id: 7, user_name: 'Grecia G.', execution_id: null } })
    expect(a).toBe(b)
  })

  it('sin origen agrupa por remitente, como siempre', () => {
    expect(originGroupKey({ sender: 'cliente', origin: null })).toBe('cliente')
    expect(originGroupKey({ sender: 'vendedor', origin: null })).toBe('vendedor')
  })
})
