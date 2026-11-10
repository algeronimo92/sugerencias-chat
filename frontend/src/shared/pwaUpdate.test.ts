import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyPwaUpdate,
  registerPwaUpdater,
  resetPwaUpdateStore,
  setPwaCurrentChatId,
  setPwaUpdatePending,
  usePwaCurrentChatId,
  usePwaUpdatePending,
} from './pwaUpdate'

describe('pwaUpdate store', () => {
  beforeEach(() => resetPwaUpdateStore())

  it('avisa a quien observa el build pendiente y el chat actual', () => {
    const pending = renderHook(() => usePwaUpdatePending())
    const chat = renderHook(() => usePwaCurrentChatId())
    expect(pending.result.current).toBe(false)
    expect(chat.result.current).toBeNull()

    act(() => setPwaUpdatePending(true))
    act(() => setPwaCurrentChatId('chat-1'))
    expect(pending.result.current).toBe(true)
    expect(chat.result.current).toBe('chat-1')
  })

  it('aplica la actualización con lo que registró el prompt, y no falla sin él', () => {
    expect(() => applyPwaUpdate()).not.toThrow()
    const apply = vi.fn()
    registerPwaUpdater(apply)
    applyPwaUpdate()
    expect(apply).toHaveBeenCalledTimes(1)
  })
})
