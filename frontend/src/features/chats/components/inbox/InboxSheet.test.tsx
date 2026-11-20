import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { createTestQueryClient, queryWrapper } from '../../../../test/queryWrapper'
import { installFakeApi } from '../../../../test/fakeApi'
import { EMPTY_CHAT_FILTERS, type ChatFilters } from '../../../leads/types'
import type { ChatFiltersState, ChatQuickFilter } from '../../layoutContext'
import { InboxSheet } from './InboxSheet'

const api = installFakeApi()

// Con la suite entera en paralelo, la primera respuesta de la API falsa llega
// después del segundo que espera `findBy` por defecto.
const SLOW = { timeout: 5000 }

function Harness() {
  const [open, setOpen] = useState(true)
  const [chatFilter, setChatFilter] = useState<ChatQuickFilter>('all')
  const [advancedFilters, setAdvancedFilters] = useState<ChatFilters>(EMPTY_CHAT_FILTERS)
  const filters = { chatFilter, setChatFilter, advancedFilters, setAdvancedFilters } as unknown as ChatFiltersState
  return (
    <>
      <p>bandeja: {chatFilter}</p>
      <InboxSheet filters={filters} open={open} onOpenChange={setOpen} />
    </>
  )
}

describe('bandejas en el celular', () => {
  beforeEach(() => {
    api.current.on('get', '/api/chats/counts', { data: { all: 46, unread: 9, mine: 12, unassigned: 4, open: 30, closed: 16, waiting: 7, stages: {} } })
  })

  it('elegir una bandeja no cierra la hoja; "Ver conversaciones" vuelve a la lista', async () => {
    render(<Harness />, { wrapper: queryWrapper(createTestQueryClient()) })

    const sheet = await screen.findByRole('dialog', { name: 'Bandejas' }, SLOW)
    await userEvent.click(await screen.findByRole('button', { name: /Mías\s*12/ }, SLOW))
    expect(sheet).toBeInTheDocument()
    expect(screen.getByText('bandeja: mine')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Ver conversaciones' }))
    expect(screen.queryByRole('dialog', { name: 'Bandejas' })).not.toBeInTheDocument()
  })
})
