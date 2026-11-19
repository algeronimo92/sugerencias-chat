import { describe, expect, it } from 'vitest'
import type { ImportSummary } from '../types'
import { formatPhone, initialSelection, selectionCount, splitTags, toSelection } from './selection'

function summary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    id: 'b1',
    source: 'whatsapp_app',
    status: 'open',
    file_name: null,
    created_at: null,
    updated_at: null,
    closed_at: null,
    counts: {
      pending: 400, invalid: 3, existing: 20, with_interaction: 250,
      created: 0, updated: 0, skipped: 0, discarded: 0,
    },
    recent: [
      { days: 1, count: 4 }, { days: 7, count: 30 }, { days: 30, count: 90 },
      { days: 90, count: 180 }, { days: 180, count: 250 },
    ],
    ...overrides,
  }
}

describe('cuántos contactos se importan', () => {
  it('del celular empieza por los que conversaron en los últimos 3 meses', () => {
    const draft = initialSelection(summary())
    expect(draft.scope).toBe('recent')
    expect(selectionCount(summary(), draft)).toBe(180)
  })

  it('un CSV va entero y se cierra al terminar', () => {
    const csv = summary({ source: 'csv', counts: { ...summary().counts, with_interaction: 0 } })
    const draft = initialSelection(csv)
    expect(draft.scope).toBe('all')
    expect(draft.close).toBe(true)
    expect(selectionCount(csv, draft)).toBe(400)
  })

  it('el tope recorta el alcance elegido', () => {
    const draft = { ...initialSelection(summary()), scope: 'all' as const, limit: '50' }
    expect(selectionCount(summary(), draft)).toBe(50)
    expect(selectionCount(summary(), { ...draft, limit: '9999' })).toBe(400)
    expect(selectionCount(summary(), { ...draft, limit: 'abc' })).toBe(400)
  })

  it('la selección manual cuenta las filas marcadas y viaja sin días', () => {
    const draft = { ...initialSelection(summary()), scope: 'manual' as const, rowIds: [3, 7], tags: 'vip, VIP; nuevo' }
    expect(selectionCount(summary(), draft)).toBe(2)
    expect(toSelection(draft)).toEqual({
      mode: 'manual', days: null, limit: null, row_ids: [3, 7], duplicates: 'skip', tags: ['vip', 'nuevo'], close: false,
    })
  })
})

describe('textos', () => {
  it('separa etiquetas sin repetir', () => {
    expect(splitTags(' a ,b;; A ')).toEqual(['a', 'b'])
  })

  it('muestra los números de Perú agrupados', () => {
    expect(formatPhone('51987654321')).toBe('+51 987 654 321')
    expect(formatPhone('5491122334455')).toBe('+5491122334455')
    expect(formatPhone(null)).toBe('')
  })
})
