import { describe, expect, it } from 'vitest'
import { flowHistoryReducer } from './useFlowHistory'

interface TestHistory<T> {
  past: T[]
  present: T
  future: T[]
  lastGroupKey: string | null
  lastGroupAt: number
}

function initial<T>(present: T): TestHistory<T> {
  return { past: [], present, future: [], lastGroupKey: null, lastGroupAt: 0 }
}

function commit<T>(state: TestHistory<T>, value: T, options: { groupKey?: string; timestamp?: number; limit?: number } = {}) {
  return flowHistoryReducer(state, {
    type: 'commit',
    update: value,
    groupKey: options.groupKey,
    timestamp: options.timestamp ?? 0,
    limit: options.limit ?? 50,
    mergeWindowMs: 800,
  })
}

describe('flowHistoryReducer', () => {
  it('deshace y rehace un cambio', () => {
    const changed = commit(initial('a'), 'b')
    const undone = flowHistoryReducer(changed, { type: 'undo' })
    expect(undone.present).toBe('a')
    expect(undone.future).toEqual(['b'])
    expect(flowHistoryReducer(undone, { type: 'redo' }).present).toBe('b')
  })

  it('agrupa ediciones consecutivas del mismo campo', () => {
    const first = commit(initial(''), 'h', { groupKey: 'message', timestamp: 100 })
    const second = commit(first, 'ho', { groupKey: 'message', timestamp: 400 })
    const third = commit(second, 'hola', { groupKey: 'message', timestamp: 700 })
    expect(third.past).toEqual([''])
    expect(flowHistoryReducer(third, { type: 'undo' }).present).toBe('')
  })

  it('inicia otro paso cuando vence la ventana de agrupación', () => {
    const first = commit(initial(''), 'hola', { groupKey: 'message', timestamp: 100 })
    const second = commit(first, 'hola mundo', { groupKey: 'message', timestamp: 1000 })
    expect(second.past).toEqual(['', 'hola'])
  })

  it('descarta rehacer cuando se edita después de deshacer', () => {
    const changed = commit(commit(initial(0), 1), 2)
    const undone = flowHistoryReducer(changed, { type: 'undo' })
    expect(undone.future).toEqual([2])
    expect(commit(undone, 3).future).toEqual([])
  })

  it('respeta el límite de estados anteriores', () => {
    const one = commit(initial(0), 1, { limit: 2 })
    const two = commit(one, 2, { limit: 2 })
    const three = commit(two, 3, { limit: 2 })
    expect(three.past).toEqual([1, 2])
  })

  it('sincroniza la respuesta guardada sin borrar el historial', () => {
    const changed = commit(initial<{ value: number; normalized?: boolean }>({ value: 1 }), { value: 2 })
    const synced = flowHistoryReducer(changed, { type: 'sync', value: { value: 2, normalized: true } })
    expect(synced.past).toEqual([{ value: 1 }])
    expect(synced.present).toEqual({ value: 2, normalized: true })
  })
})
