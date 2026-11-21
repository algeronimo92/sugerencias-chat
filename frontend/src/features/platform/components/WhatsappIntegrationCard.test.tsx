import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WhatsappIntegrationCard } from './WhatsappIntegrationCard'

const mocks = vi.hoisted(() => ({
  status: null as { state: string; instance: string | null; disconnected_at?: string | null } | null,
}))

vi.mock('../hooks/useWhatsapp', () => ({
  useWhatsappStatus: () => ({ data: mocks.status }),
}))
vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({ data: [] }),
}))
// El panel de vinculación carga el SDK de Meta: acá solo importa la cabecera.
vi.mock('./WhatsappPanel', () => ({ WhatsappPanel: () => null }))
vi.mock('./IntegrationSettingsForm', () => ({ IntegrationSettingsForm: () => null }))

describe('WhatsappIntegrationCard', () => {
  it('conectado: lo dice', () => {
    mocks.status = { state: 'open', instance: null }
    render(<WhatsappIntegrationCard />)

    expect(screen.getByText('Conectado')).toBeInTheDocument()
  })

  it('desvinculado desde WhatsApp: deja de decir "conectado" aunque las claves sigan guardadas', () => {
    mocks.status = { state: 'disconnected', instance: null, disconnected_at: '2026-11-21T03:51:41Z' }
    render(<WhatsappIntegrationCard />)

    expect(screen.getByText('Desconectado')).toBeInTheDocument()
    expect(screen.queryByText('Conectado')).not.toBeInTheDocument()
  })

  it('sin credenciales: sin configurar', () => {
    mocks.status = { state: 'not_configured', instance: null }
    render(<WhatsappIntegrationCard />)

    expect(screen.getByText('Sin configurar')).toBeInTheDocument()
  })
})
