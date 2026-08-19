import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Chat, Message } from '../types'
import { ChatPeekDialog } from './ChatPeekDialog'

const CHAT = {
  chat_id: 'chat-1',
  name: 'Ana Torres',
  phone: '51999999999',
} as Chat

const MESSAGES = [
  {
    id: 1,
    sender: 'cliente',
    content: 'Hola, quisiera información',
    sent_at: '2026-08-19T14:00:00Z',
    media_url: null,
    wa_message_id: 'wa-1',
    status: 'DELIVERY_ACK',
    message_type: 'text',
  },
  {
    id: 2,
    sender: 'vendedor',
    content: 'Claro, te ayudo',
    sent_at: '2026-08-19T14:01:00Z',
    media_url: null,
    wa_message_id: 'wa-2',
    status: 'READ',
    message_type: 'text',
  },
] as Message[]

vi.mock('../hooks/useMessages', () => ({
  useMessages: () => ({
    data: { pages: [{ items: MESSAGES, has_more: false }] },
    isLoading: false,
    error: null,
  }),
}))

describe('ChatPeekDialog', () => {
  it('muestra mensajes sin ofrecer acciones de escritura y permite abrir el chat', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()

    render(<ChatPeekDialog chat={CHAT} onClose={vi.fn()} onOpen={onOpen} />)

    expect(screen.getByText('Vista rápida · no se marcará como leído')).toBeInTheDocument()
    expect(screen.getByText('Hola, quisiera información')).toBeInTheDocument()
    expect(screen.getByText('Claro, te ayudo')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Abrir chat' }))
    expect(onOpen).toHaveBeenCalledOnce()
  })
})
