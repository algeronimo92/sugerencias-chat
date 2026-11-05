import { describe, expect, it } from 'vitest'
import { EMPTY_CHAT_FILTERS } from '../../leads/types'
import { BUILT_IN_VIEWS, diffFromEmpty, filtersEqual, viewFilters } from './savedViews'

describe('savedViews', () => {
  it('una vista se reconoce activa aunque las etiquetas vengan en otro orden', () => {
    const view = { id: 'x', label: 'X', filters: diffFromEmpty({ ...EMPTY_CHAT_FILTERS, tagIds: [3, 1], waitingTime: 'urgent' }) }
    expect(filtersEqual(viewFilters(view), { ...EMPTY_CHAT_FILTERS, tagIds: [1, 3], waitingTime: 'urgent' })).toBe(true)
    expect(filtersEqual(viewFilters(view), { ...EMPTY_CHAT_FILTERS, tagIds: [1], waitingTime: 'urgent' })).toBe(false)
  })

  it('guarda solo los campos que difieren de cero', () => {
    expect(diffFromEmpty({ ...EMPTY_CHAT_FILTERS, inactiveDays: 7, unreadOnly: true })).toEqual({ inactiveDays: 7 })
  })

  it('las vistas predefinidas no coinciden con los filtros vacíos', () => {
    for (const view of BUILT_IN_VIEWS) expect(filtersEqual(viewFilters(view), EMPTY_CHAT_FILTERS)).toBe(false)
  })
})
