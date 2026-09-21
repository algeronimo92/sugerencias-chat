import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Chat } from '../types'
import { ContactSendDialog } from './ContactSendDialog'

const mocks = vi.hoisted(() => ({
  sendContacts: vi.fn(),
}))

const CONTACTS = [
  { chat_id: 'lead-ana', name: 'Ana Torres', phone: '51911111111' },
  { chat_id: 'lead-luis', name: 'Luis Pérez', phone: '51922222222' },
] as Chat[]

vi.mock('../hooks/useChats', () => ({
  useInfiniteChats: () => ({
    data: { pages: [{ items: CONTACTS, has_more: false }] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}))

vi.mock('../hooks/useMessages', () => ({
  useSendContacts: () => ({ mutate: mocks.sendContacts, isPending: false }),
}))

describe('ContactSendDialog', () => {
  beforeEach(() => mocks.sendContacts.mockReset())

  it('selecciona varios contactos, los confirma y los envía juntos', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSent = vi.fn()
    render(
      <ContactSendDialog
        chatId="lead-destino"
        targetName="Dermicapro"
        replyTo={null}
        onSent={onSent}
        onClose={onClose}
      />,
    )

    expect(screen.getByPlaceholderText('Buscar un nombre o número')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Ana Torres/ }))
    await user.click(screen.getByRole('button', { name: /Luis Pérez/ }))
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(screen.getByRole('dialog', { name: /¿Deseas enviar 2 contactos a "Dermicapro"/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enviar 2 contactos' }))

    expect(mocks.sendContacts).toHaveBeenCalledOnce()
    expect(mocks.sendContacts.mock.calls[0][0]).toEqual({
      contacts: [
        { fullName: 'Ana Torres', phoneNumber: '51911111111' },
        { fullName: 'Luis Pérez', phoneNumber: '51922222222' },
      ],
      replyTo: null,
    })
    mocks.sendContacts.mock.calls[0][1].onSuccess()
    expect(onSent).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
