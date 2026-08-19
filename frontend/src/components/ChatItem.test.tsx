import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Chat } from '../types'
import { ChatItem } from './ChatItem'

const CHAT = {
  chat_id: 'chat-1',
  name: 'Ana Torres',
  phone: '51999999999',
  last_message: 'Hola',
  last_message_type: 'text',
  timestamp: '2026-08-19T14:00:00Z',
  unread_count: 2,
  tags: [],
} as unknown as Chat

function renderItem(onClick = vi.fn(), onPreview = vi.fn()) {
  render(
    <ChatItem
      chat={CHAT}
      isSelected={false}
      isHighlighted={false}
      onClick={onClick}
      onPreview={onPreview}
    />,
  )
  return { onClick, onPreview }
}

describe('ChatItem vista rápida', () => {
  it('abre la vista rápida con clic derecho sin abrir el chat', () => {
    const { onClick, onPreview } = renderItem()

    fireEvent.contextMenu(screen.getByRole('button'))

    expect(onPreview).toHaveBeenCalledOnce()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('abre la vista rápida tras una pulsación prolongada', () => {
    vi.useFakeTimers()
    const { onClick, onPreview } = renderItem()
    const item = screen.getByRole('button')

    fireEvent.pointerDown(item, { pointerType: 'touch', clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(450))
    fireEvent.pointerUp(item)
    fireEvent.click(item)

    expect(onPreview).toHaveBeenCalledOnce()
    expect(onClick).not.toHaveBeenCalled()
  })
})
