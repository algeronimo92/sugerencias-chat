import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WhatsappPanel } from './WhatsappPanel'

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  remove: vi.fn(),
  evolutionStatus: { state: 'missing', instance: 'evolution-org', qr_base64: null, pairing_code: null },
}))

vi.mock('../hooks/useFacebookSdk', () => ({ useFacebookSdk: () => false }))
vi.mock('../hooks/useSettings', () => ({
  useMetaPublicConfig: () => ({ data: { app_id: null, config_id: null }, isLoading: false }),
  useCompleteMetaEmbeddedSignup: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../hooks/useWhatsapp', () => ({
  useWhatsappStatus: () => ({ data: { state: 'not_configured', instance: null } }),
  useEvolutionStatus: () => ({ data: mocks.evolutionStatus, isLoading: false, error: null }),
  useConnectEvolution: () => ({ mutate: mocks.connect, isPending: false }),
  useRemoveEvolution: () => ({ mutate: mocks.remove, isPending: false }),
}))

describe('WhatsappPanel Evolution', () => {
  beforeEach(() => {
    mocks.connect.mockReset()
    mocks.remove.mockReset()
    mocks.evolutionStatus = { state: 'missing', instance: 'evolution-org', qr_base64: null, pairing_code: null }
  })

  it('envía el teléfono al backend y muestra el QR devuelto', async () => {
    const user = userEvent.setup()
    mocks.connect.mockImplementation((_phone: string, options: { onSuccess: (value: unknown) => void }) => {
      options.onSuccess({
        state: 'connecting',
        instance: 'evolution-org',
        qr_base64: 'QR-CONTENT',
        pairing_code: 'ABCD1234',
      })
    })
    render(<WhatsappPanel onGoToClaves={vi.fn()} />)

    await user.type(screen.getByLabelText('Número con código de país'), '+51 987 654 321')
    await user.click(screen.getByRole('button', { name: 'Conectar con Evolution' }))

    expect(mocks.connect).toHaveBeenCalledWith('+51 987 654 321', expect.any(Object))
    expect(screen.getByAltText('Código QR para vincular WhatsApp')).toHaveAttribute(
      'src',
      'data:image/png;base64,QR-CONTENT',
    )
    expect(screen.getByText('ABCD1234')).toBeInTheDocument()
  })

  it('aclara que Meta y Evolution pueden coexistir', () => {
    render(<WhatsappPanel onGoToClaves={vi.fn()} />)

    expect(screen.getByText(/Meta puede seguir activa/i)).toBeInTheDocument()
  })
})
