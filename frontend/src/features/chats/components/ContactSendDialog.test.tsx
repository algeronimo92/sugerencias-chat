import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Chat } from '../../leads/types'
import { ContactSendDialog } from './ContactSendDialog'

const mocks = vi.hoisted(() => ({
  sendContacts: vi.fn(),
  contacts: null as unknown[] | null,
}))

const CONTACTS = [
  { chat_id: 'lead-ana', name: 'Ana Torres', phone: '51911111111' },
  { chat_id: 'lead-luis', name: 'Luis Pérez', phone: '51922222222' },
] as Chat[]

vi.mock('../../leads/public/queries', () => ({
  useInfiniteChats: () => ({
    data: { pages: [{ items: mocks.contacts ?? CONTACTS, has_more: false }] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}))

vi.mock('../hooks/useOutboundMessage', () => ({
  useOutboundMessage: () => ({ mutate: mocks.sendContacts, isPending: false }),
}))

describe('ContactSendDialog', () => {
  beforeEach(() => mocks.sendContacts.mockReset())
  afterEach(() => { mocks.contacts = null })

  it('al llegar al límite avisa una sola vez y no agrega el contacto', async () => {
    // React puede ejecutar un updater dos veces: el aviso vivía ahí y salía repetido.
    mocks.contacts = Array.from({ length: 21 }, (_, index) => ({ chat_id: `lead-${index}`, name: `Contacto ${index}`, phone: `5190000${String(index).padStart(4, '0')}` }))
    const error = vi.spyOn(toast, 'error').mockImplementation(() => 'toast')
    const user = userEvent.setup()
    // StrictMode ejecuta cada updater dos veces, como puede hacerlo React en producción.
    render(<StrictMode><ContactSendDialog chatId="lead-destino" targetName="Dermicapro" replyTo={null} onSent={vi.fn()} onClose={vi.fn()} /></StrictMode>)

    for (let index = 0; index < 20; index++) {
      await user.click(screen.getByRole('button', { name: new RegExp(`Contacto ${index}5190000`) }))
    }
    await user.click(screen.getByRole('button', { name: /Contacto 205190000/ }))

    expect(error).toHaveBeenCalledOnce()
    expect(error.mock.calls[0][0]).toContain('hasta 20 contactos')
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument()
    error.mockRestore()
  })

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
      kind: 'contacts',
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
