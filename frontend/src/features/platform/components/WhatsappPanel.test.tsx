import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WhatsappPanel } from './WhatsappPanel'

const state = vi.hoisted(() => ({
  linked: true,
  onBusinessApp: true as boolean | null,
  start: vi.fn(),
}))

vi.mock('../hooks/useWhatsapp', () => ({
  useWhatsappStatus: () => ({ data: { state: state.linked ? 'open' : 'not_configured' } }),
  useCallingReadiness: () => ({ data: { on_business_app: state.onBusinessApp } }),
}))
vi.mock('../hooks/useSettings', () => ({
  useCompleteMetaEmbeddedSignup: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../hooks/useMetaEmbeddedSignup', () => ({
  useMetaEmbeddedSignup: () => ({
    loading: false, configured: true, ready: true, start: state.start, error: null, setError: vi.fn(),
  }),
}))
// Los paneles de costos, conversiones y llamadas tienen sus propias pruebas.
vi.mock('./WhatsappCostsPanel', () => ({ WhatsappCostsPanel: () => null }))
vi.mock('./MetaConversionsPanel', () => ({ MetaConversionsPanel: () => null }))
vi.mock('./CallsSettings', () => ({ CallsSettings: () => null }))

describe('WhatsappPanel: mudar el número de modo', () => {
  beforeEach(() => {
    state.linked = true
    state.onBusinessApp = true
    state.start.mockReset()
  })

  it('un número en el celular se pasa a solo CRM después de confirmar que se borró la cuenta en la app', async () => {
    const user = userEvent.setup()
    render(<WhatsappPanel />)

    await user.click(screen.getByRole('button', { name: 'Pasar este número a solo CRM' }))
    const continuar = screen.getByRole('button', { name: 'Continuar con Meta' })
    expect(continuar).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /Ya borré la cuenta/ }))
    await user.click(continuar)

    expect(state.start).toHaveBeenCalledWith('cloud_api')
  })

  it('un número que ya está solo en el CRM explica cómo volver al celular, sin botón de mudanza', () => {
    state.onBusinessApp = false
    render(<WhatsappPanel />)

    expect(screen.getByText('Número vinculado solo al CRM. No funciona en la app del celular.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pasar este número a solo CRM' })).not.toBeInTheDocument()
    expect(screen.getByText('¿Quieres volver a usar este número en el celular?')).toBeInTheDocument()
  })

  it('si Meta no informó el modo no ofrece mudar nada', () => {
    state.onBusinessApp = null
    render(<WhatsappPanel />)

    expect(screen.getByText('Número vinculado.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pasar este número a solo CRM' })).not.toBeInTheDocument()
    expect(screen.queryByText('¿Quieres volver a usar este número en el celular?')).not.toBeInTheDocument()
  })

  it('sin número vinculado solo ofrece vincular', () => {
    state.linked = false
    render(<WhatsappPanel />)

    expect(screen.getByRole('button', { name: 'Vincular con Meta' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pasar este número a solo CRM' })).not.toBeInTheDocument()
  })
})
