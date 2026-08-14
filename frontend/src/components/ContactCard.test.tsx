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
  usePhoneConfig: () => ({ data: { default_country_code: '51' } }),
}))
// El alta completa se prueba aparte; acá solo importa que se abra prellenada.
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

const ANA = { fullName: 'Ana', phone: '51987654321', phoneLabel: '+51 987 654 321' }

describe('ContactCard', () => {
  beforeEach(() => {
    mocks.navigate.mockReset()
    mocks.findLeadByPhone.mockReset()
    mocks.createLead.mockReset()
  })

  it('abre la conversación del lead que ya tiene ese número', async () => {
    const user = userEvent.setup()
    mocks.findLeadByPhone.mockResolvedValue({ chat_id: '51987654321@s.whatsapp.net' })
    render(<ContactCard contacts={[ANA]} />)

    await user.click(screen.getByRole('button', { name: /Enviar mensaje/ }))

    expect(mocks.findLeadByPhone).toHaveBeenCalledWith('51987654321')
    expect(mocks.navigate).toHaveBeenCalledWith('/chat/51987654321@s.whatsapp.net')
  })

  it('ofrece el alta prellenada y abre el chat nuevo cuando el lead no existe', async () => {
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

  it('normaliza el número local del vCard antes de buscar el lead', async () => {
    const user = userEvent.setup()
    mocks.findLeadByPhone.mockResolvedValue(null)
    render(<ContactCard contacts={[{ fullName: 'Ana', phone: '987654321', phoneLabel: '987 654 321' }]} />)

    await user.click(screen.getByRole('button', { name: /Enviar mensaje/ }))
    expect(mocks.findLeadByPhone).toHaveBeenCalledWith('51987654321')
  })

  it('no ofrece escribirle a un contacto compartido sin número', () => {
    render(<ContactCard contacts={[{ fullName: 'Ana', phone: null, phoneLabel: '' }]} />)

    expect(screen.queryByRole('button', { name: /Enviar mensaje/ })).toBeNull()
    expect(screen.getByText('No llegó el número de este contacto')).toBeInTheDocument()
  })
})
