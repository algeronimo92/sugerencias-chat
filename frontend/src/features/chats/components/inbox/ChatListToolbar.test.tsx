import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestQueryClient, queryWrapper } from '../../../../test/queryWrapper'
import { installFakeApi } from '../../../../test/fakeApi'
import { EMPTY_CHAT_FILTERS } from '../../../leads/types'
import type { ChatFiltersState } from '../../layoutContext'
import { ChatListToolbar } from './ChatListToolbar'

const api = installFakeApi()

// Con la suite entera en paralelo, la primera respuesta de la API falsa llega
// después del segundo que espera `findBy` por defecto.
const SLOW = { timeout: 5000 }

function renderToolbar(overrides: Partial<ChatFiltersState> = {}, searching = false) {
  const filters = {
    effectiveFilters: { ...EMPTY_CHAT_FILTERS, unassigned: true, conversation: 'open' },
    conversation: 'open',
    setConversation: vi.fn(),
    order: 'recent',
    setOrder: vi.fn(),
    ...overrides,
  } as unknown as ChatFiltersState
  render(<ChatListToolbar filters={filters} searching={searching} />, { wrapper: queryWrapper(createTestQueryClient()) })
  return filters
}

describe('cabecera de la lista', () => {
  beforeEach(() => {
    api.current.on('get', '/api/chats/counts', { data: { all: 46, unread: 9, mine: 12, unassigned: 4, open: 30, closed: 16, waiting: 7, stages: {} } })
  })

  it('el estado dice cuántas hay y los números siguen a la bandeja, no al estado', async () => {
    renderToolbar()

    const state = await screen.findByRole('combobox', { name: 'Estado de la conversación' }, SLOW)
    await waitFor(() => expect(state).toHaveTextContent('Abiertas 30'), SLOW)
    // Se cuentan con la bandeja elegida (sin asignar) pero sin el estado:
    // si no, "Cerradas" siempre daría 0 con "Abiertas" elegida.
    expect(api.current.calls('get', '/api/chats/counts').at(-1)?.params).toEqual({ unassigned: 'true' })
  })

  it('elegir otro estado y otro orden los cambia', async () => {
    const filters = renderToolbar()

    await userEvent.click(await screen.findByRole('combobox', { name: 'Estado de la conversación' }, SLOW))
    await userEvent.click(await screen.findByRole('option', { name: 'Cerradas 16' }, SLOW))
    expect(filters.setConversation).toHaveBeenCalledWith('closed')

    await userEvent.click(screen.getByRole('combobox', { name: 'Ordenar' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Quién espera más' }))
    expect(filters.setOrder).toHaveBeenCalledWith('waiting')
  })

  it('con una búsqueda no ofrece ordenar', async () => {
    renderToolbar({}, true)

    await screen.findByRole('combobox', { name: 'Estado de la conversación' }, SLOW)
    expect(screen.queryByRole('combobox', { name: 'Ordenar' })).not.toBeInTheDocument()
  })
})
