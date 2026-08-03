import { useCallback, useReducer, type SetStateAction } from 'react'

const DEFAULT_HISTORY_LIMIT = 50
const DEFAULT_MERGE_WINDOW_MS = 800

interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
  lastGroupKey: string | null
  lastGroupAt: number
}

type HistoryAction<T> =
  | { type: 'commit'; update: SetStateAction<T>; groupKey?: string; timestamp: number; limit: number; mergeWindowMs: number }
  | { type: 'sync'; value: T }
  | { type: 'undo' }
  | { type: 'redo' }

function resolveUpdate<T>(update: SetStateAction<T>, current: T): T {
  return typeof update === 'function' ? (update as (value: T) => T)(current) : update
}

export function flowHistoryReducer<T>(state: HistoryState<T>, action: HistoryAction<T>): HistoryState<T> {
  if (action.type === 'undo') {
    const previous = state.past.at(-1)
    if (previous === undefined) return state
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
      lastGroupKey: null,
      lastGroupAt: 0,
    }
  }

  if (action.type === 'redo') {
    const next = state.future[0]
    if (next === undefined) return state
    return {
      past: [...state.past, state.present],
      present: next,
      future: state.future.slice(1),
      lastGroupKey: null,
      lastGroupAt: 0,
    }
  }

  if (action.type === 'sync') {
    if (Object.is(action.value, state.present)) return state
    return { ...state, present: action.value, lastGroupKey: null, lastGroupAt: 0 }
  }

  const next = resolveUpdate(action.update, state.present)
  if (Object.is(next, state.present)) return state
  const mergeWithPrevious = !!action.groupKey
    && action.groupKey === state.lastGroupKey
    && action.timestamp - state.lastGroupAt <= action.mergeWindowMs
  const past = mergeWithPrevious
    ? state.past
    : [...state.past, state.present].slice(-action.limit)
  return {
    past,
    present: next,
    // Una edición nueva después de deshacer crea una rama nueva: lo que se
    // podía rehacer deja de ser válido, igual que en un editor convencional.
    future: [],
    lastGroupKey: action.groupKey ?? null,
    lastGroupAt: action.groupKey ? action.timestamp : 0,
  }
}

export function useFlowHistory<T>(
  initializer: T | (() => T),
  { limit = DEFAULT_HISTORY_LIMIT, mergeWindowMs = DEFAULT_MERGE_WINDOW_MS } = {},
) {
  const [history, dispatch] = useReducer(
    flowHistoryReducer<T>,
    undefined,
    () => ({
      past: [],
      present: typeof initializer === 'function' ? (initializer as () => T)() : initializer,
      future: [],
      lastGroupKey: null,
      lastGroupAt: 0,
    }),
  )

  const commit = useCallback((update: SetStateAction<T>, groupKey?: string) => {
    dispatch({ type: 'commit', update, groupKey, timestamp: Date.now(), limit, mergeWindowMs })
  }, [limit, mergeWindowMs])

  const sync = useCallback((value: T) => dispatch({ type: 'sync', value }), [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])

  return {
    value: history.present,
    commit,
    sync,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  }
}

