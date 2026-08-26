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
  last_customer_message_at: '2026-08-19T14:00:00Z',
  unread_count: 2,
  tags: [],
} as unknown as Chat

function renderItem(onClick = vi.fn(), onPreview = vi.fn(), onMarkUnread = vi.fn(), chat: Chat = CHAT) {
  render(
    <ChatItem
      chat={chat}
      isSelected={false}
      isHighlighted={false}
      onClick={onClick}
      onPreview={onPreview}
      onMarkUnread={onMarkUnread}
    />,
  )
  return { onClick, onPreview, onMarkUnread }
}

describe('ChatItem vista rápida', () => {
  it('muestra las acciones del lead con clic derecho', () => {
    const { onClick, onPreview } = renderItem()

    fireEvent.contextMenu(screen.getByRole('button', { name: /Ana Torres/ }))

    expect(screen.getByRole('menuitem', { name: 'Vista rápida' })).toBeInTheDocument()
    expect(onPreview).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('permite marcar como no leído desde el menú contextual', () => {
    const readChat = { ...CHAT, unread_count: 0 } as Chat
    const { onClick, onMarkUnread } = renderItem(vi.fn(), vi.fn(), vi.fn(), readChat)

    fireEvent.contextMenu(screen.getByRole('button', { name: /Ana Torres/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Marcar como no leído' }))

    expect(onMarkUnread).toHaveBeenCalledOnce()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('muestra la cantidad de mensajes sin leer', () => {
    renderItem()

    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByLabelText('2 mensajes sin leer')).toBeInTheDocument()
  })

  it('abre la vista rápida tras una pulsación prolongada', () => {
    vi.useFakeTimers()
    const { onClick, onPreview } = renderItem()
    const item = screen.getByRole('button', { name: /Ana Torres/ })

    fireEvent.pointerDown(item, { pointerType: 'touch', clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(450))
    fireEvent.pointerUp(item)
    fireEvent.click(item)

    expect(onPreview).toHaveBeenCalledOnce()
    expect(onClick).not.toHaveBeenCalled()
  })
})
