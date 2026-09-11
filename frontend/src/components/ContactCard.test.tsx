import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ContactCard } from './ContactCard'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  findLeadByPhone: vi.fn(),
  createLead: vi.fn(),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('../hooks/useChats', () => ({
  useFindLeadByPhone: () => mocks.findLeadByPhone,
  useCreateLead: () => ({ mutate: mocks.createLead, isPending: false }),
}))
// El alta completa se prueba aparte; acá solo importa que se abra prellenada
// con el número que se eligió.
vi.mock('./LeadFormDialog', () => ({
  LeadFormDialog: ({ initial, onSubmit }: {
    initial?: { phone?: string | null; name?: string | null }
    onSubmit: (values: { phone?: string | null; name?: string | null }) => void
  }) => (
    <div>
      <p>Alta de {initial?.name} ({initial?.phone})</p>
      <button type="button" onClick={() => onSubmit(initial ?? {})}>Agregar</button>
    </div>
  ),
}))

const ANA = { name: 'Ana', phone: ['51987654321'], phoneLabel: '' }
const CON_DOS_NUMEROS = { name: 'Bruno', phone: ['51987654321', '51911223344'], phoneLabel: '' }

describe('ContactCard', () => {
  beforeEach(() => {
    mocks.navigate.mockReset()
    mocks.findLeadByPhone.mockReset()
    mocks.createLead.mockReset()
  })

  it('con un solo número, abre directo la conversación del lead que ya lo tiene', async () => {
    const user = userEvent.setup()
    mocks.findLeadByPhone.mockResolvedValue({ chat_id: '51987654321@s.whatsapp.net' })
    render(<ContactCard contacts={[ANA]} />)

    await user.click(screen.getByRole('button', { name: /Enviar mensaje/ }))

    expect(mocks.findLeadByPhone).toHaveBeenCalledWith('51987654321')
    expect(mocks.navigate).toHaveBeenCalledWith('/chat/51987654321@s.whatsapp.net')
  })

  it('con un solo número, ofrece el alta prellenada cuando el lead no existe', async () => {
    const user = userEvent.setup()
    mocks.findLeadByPhone.mockResolvedValue(null)
    mocks.createLead.mockImplementation((_payload, { onSuccess }) => onSuccess({ chat_id: 'nuevo' }))
    render(<ContactCard contacts={[ANA]} />)

    await user.click(screen.getByRole('button', { name: /Enviar mensaje/ }))
    expect(await screen.findByText('Alta de Ana (51987654321)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(mocks.createLead).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '51987654321', name: 'Ana' }),
      expect.any(Object),
    )
    expect(mocks.navigate).toHaveBeenCalledWith('/chat/nuevo')
  })

  it('no ofrece escribirle a un contacto compartido sin número', () => {
    render(<ContactCard contacts={[{ name: 'Ana', phone: null, phoneLabel: '' }]} />)

    expect(screen.queryByRole('button', { name: /Enviar mensaje/ })).toBeNull()
    expect(screen.getByText('No llegó el número de este contacto')).toBeInTheDocument()
  })

  it('con varios números, abre un selector en vez de mandar directo', async () => {
    const user = userEvent.setup()
    render(<ContactCard contacts={[CON_DOS_NUMEROS]} />)

    await user.click(screen.getByRole('button', { name: /Enviar mensaje/ }))

    expect(mocks.findLeadByPhone).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('+51987654321')).toBeInTheDocument()
    expect(screen.getByText('+51911223344')).toBeInTheDocument()
  })

  it('elegir un número del selector abre el chat de ese número puntual', async () => {
    const user = userEvent.setup()
    mocks.findLeadByPhone.mockResolvedValue({ chat_id: '51911223344@s.whatsapp.net' })
    render(<ContactCard contacts={[CON_DOS_NUMEROS]} />)

    await user.click(screen.getByRole('button', { name: /Enviar mensaje/ }))
    await user.click(screen.getByText('+51911223344'))

    expect(mocks.findLeadByPhone).toHaveBeenCalledWith('51911223344')
    expect(mocks.findLeadByPhone).not.toHaveBeenCalledWith('51987654321')
    expect(mocks.navigate).toHaveBeenCalledWith('/chat/51911223344@s.whatsapp.net')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
