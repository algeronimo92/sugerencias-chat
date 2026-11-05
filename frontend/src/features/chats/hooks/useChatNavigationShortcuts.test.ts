import { fireEvent, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Chat } from '../../leads/types'
import { useChatNavigationShortcuts } from './useChatNavigationShortcuts'

const chats = ['a', 'b', 'c'].map((chat_id) => ({ chat_id }) as Chat)

describe('useChatNavigationShortcuts', () => {
  it('Alt+↓ y Alt+↑ recorren la lista visible sin pasarse de los bordes', () => {
    const onSelect = vi.fn()
    const { rerender } = renderHook(({ selected }) => useChatNavigationShortcuts(chats, selected, onSelect), {
      initialProps: { selected: 'b' as string | null },
    })

    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true })
    expect(onSelect).toHaveBeenLastCalledWith(chats[2])

    rerender({ selected: 'c' })
    onSelect.mockClear()
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true })
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'ArrowUp', altKey: true })
    expect(onSelect).toHaveBeenLastCalledWith(chats[1])
  })

  it('sin chat abierto empieza por el primero, y sin Alt no hace nada', () => {
    const onSelect = vi.fn()
    renderHook(() => useChatNavigationShortcuts(chats, null, onSelect))
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true })
    expect(onSelect).toHaveBeenCalledWith(chats[0])
  })
})
