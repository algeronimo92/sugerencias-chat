import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat } from '../types'
import { ChatItem } from './ChatItem'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const markNoShowMutate = vi.fn()
const deleteLeadMutate = vi.fn()

vi.mock('../hooks/useChats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useChats')>()
  return {
    ...actual,
    useMarkNoShow: () => ({ mutate: markNoShowMutate, isPending: false }),
    useDeleteLead: () => ({ mutate: deleteLeadMutate, isPending: false }),
  }
})

// Objeto mutable en vez de una constante: cada test elige el rol antes de
// renderizar, y el mock lee el valor vigente en cada llamada.
const currentUser = { role: 'vendedor' as 'vendedor' | 'admin' }
vi.mock('../hooks/useAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useAuth')>()
  return {
    ...actual,
    useMe: () => ({ data: currentUser }),
  }
})

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

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

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
    { wrapper },
  )
  return { onClick, onPreview, onMarkUnread }
}

beforeEach(() => {
  currentUser.role = 'vendedor'
  markNoShowMutate.mockReset()
  deleteLeadMutate.mockReset()
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

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
    vi.useRealTimers()
  })
})

describe('ChatItem menú contextual — copiar, no-show, eliminar y fusionar', () => {
  it('copia el teléfono', () => {
    renderItem()

    fireEvent.contextMenu(screen.getByRole('button', { name: /Ana Torres/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copiar teléfono' }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('51999999999')
  })

  it('marca no-show cuando el lead tiene una próxima cita agendada', () => {
    const chat = { ...CHAT, proxima_cita: '2026-08-20T15:00:00Z' } as Chat
    renderItem(vi.fn(), vi.fn(), vi.fn(), chat)

    fireEvent.contextMenu(screen.getByRole('button', { name: /Ana Torres/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Marcar no-show' }))

    expect(markNoShowMutate).toHaveBeenCalledOnce()
  })

  it('no ofrece marcar no-show sin una cita programada', () => {
    renderItem()

    fireEvent.contextMenu(screen.getByRole('button', { name: /Ana Torres/ }))

    expect(screen.queryByRole('menuitem', { name: 'Marcar no-show' })).not.toBeInTheDocument()
  })

  it('oculta fusionar y eliminar para un vendedor', () => {
    renderItem()

    fireEvent.contextMenu(screen.getByRole('button', { name: /Ana Torres/ }))

    expect(screen.queryByRole('menuitem', { name: 'Fusionar con...' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Eliminar lead' })).not.toBeInTheDocument()
  })

  it('un admin puede eliminar el lead tras confirmar', async () => {
    currentUser.role = 'admin'
    renderItem()

    fireEvent.contextMenu(screen.getByRole('button', { name: /Ana Torres/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Eliminar lead' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }))

    expect(deleteLeadMutate).toHaveBeenCalledWith('chat-1', expect.anything())
  })

  it('un admin ve la opción de fusionar', () => {
    currentUser.role = 'admin'
    renderItem()

    fireEvent.contextMenu(screen.getByRole('button', { name: /Ana Torres/ }))

    expect(screen.getByRole('menuitem', { name: 'Fusionar con...' })).toBeInTheDocument()
  })
})
