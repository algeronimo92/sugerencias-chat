import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MetaConversionsPanel } from './MetaConversionsPanel'

const mocks = vi.hoisted(() => ({
  data: null as Record<string, unknown> | null,
  save: vi.fn(),
}))

vi.mock('../hooks/useWhatsapp', () => ({
  useMetaConversions: () => ({ data: mocks.data, isLoading: false, isError: false }),
  useSaveMetaConversions: () => ({ mutate: mocks.save, isPending: false }),
}))

const status = (overrides: Record<string, unknown> = {}) => ({
  enabled: false, dataset_id: null, days: 30, sent: 0, pending: 0, failed: 0, recent: [], ...overrides,
})

describe('MetaConversionsPanel', () => {
  beforeEach(() => {
    mocks.save.mockReset()
  })

  it('pausado: explica que no se informa nada y deja activarlo', async () => {
    const user = userEvent.setup()
    mocks.data = status()
    render(<MetaConversionsPanel />)

    expect(screen.getByText('Pausado: las citas no se informan a Meta.')).toBeInTheDocument()
    expect(screen.getByText('Todavía no hay citas de leads que llegaron por un anuncio.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Activar' }))
    expect(mocks.save).toHaveBeenCalledWith(true, expect.anything())
  })

  it('activo: muestra cada cita informada con su estado y el error si falló', async () => {
    const user = userEvent.setup()
    mocks.data = status({
      enabled: true, dataset_id: '123456', sent: 1, failed: 1,
      recent: [
        {
          id: 2, lead_id: 'l2', lead_name: 'Rosa Díaz', appointment_id: 88, event_name: 'LeadSubmitted', status: 'failed',
          value: null, currency: null, attempts: 8, last_error: 'Meta Graph API respondió 400', created_at: '2026-11-13T15:00:00Z', sent_at: null,
        },
        {
          id: 1, lead_id: 'l1', lead_name: 'Ana Pérez', appointment_id: 87, event_name: 'LeadSubmitted', status: 'sent',
          value: 50, currency: 'PEN', attempts: 1, last_error: null, created_at: '2026-11-13T14:00:00Z', sent_at: '2026-11-13T14:00:10Z',
        },
      ],
    })
    render(<MetaConversionsPanel />)

    expect(screen.getByText(/dataset 123456/)).toBeInTheDocument()
    expect(screen.getByText('Últimos 30 días: 1 enviados · 0 en cola · 1 con error')).toBeInTheDocument()
    expect(screen.getByText(/Ana Pérez/)).toHaveTextContent('Ana Pérez · cita #87')
    expect(screen.getByText(/LeadSubmitted · Enviado a Meta/)).toBeInTheDocument()
    expect(screen.getByText('Meta Graph API respondió 400')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    expect(mocks.save).toHaveBeenCalledWith(false, expect.anything())
  })
})
