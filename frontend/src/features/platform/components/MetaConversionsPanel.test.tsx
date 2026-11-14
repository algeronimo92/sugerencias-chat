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

const counts = (event_name: string, values: Record<string, number> = {}) => ({
  event_name, sent: 0, pending: 0, skipped: 0, failed: 0, ...values,
})

const status = (overrides: Record<string, unknown> = {}) => ({
  enabled: false, accepted_by: null, accepted_at: null, dataset_id: null, test_event_code: null, days: 30,
  events: [counts('LeadSubmitted'), counts('QualifiedLead'), counts('Purchase')],
  last_error: null, leads_total: 0, leads_with_click: 0, recent: [], ...overrides,
})

describe('MetaConversionsPanel', () => {
  beforeEach(() => {
    mocks.save.mockReset()
  })

  it('apagado: no se activa sin aceptar las condiciones de Meta', async () => {
    const user = userEvent.setup()
    mocks.data = status()
    render(<MetaConversionsPanel />)

    expect(screen.getByText('Apagado: no se informa nada a Meta.')).toBeInTheDocument()
    const activate = screen.getByRole('button', { name: 'Activar' })
    expect(activate).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: 'Aceptar las condiciones' }))
    await user.click(activate)
    expect(mocks.save).toHaveBeenCalledWith({ enabled: true, accept_terms: true }, expect.anything())
  })

  it('activo: muestra quién aceptó, los contadores por evento y lo omitido con su motivo', async () => {
    const user = userEvent.setup()
    mocks.data = status({
      enabled: true, dataset_id: '123456', accepted_by: 'Gerson (admin@example.test)', accepted_at: '2026-11-13T15:00:00Z',
      events: [counts('LeadSubmitted', { sent: 4 }), counts('QualifiedLead', { sent: 2 }), counts('Purchase', { skipped: 1 })],
      leads_total: 10, leads_with_click: 4,
      recent: [{
        id: 3, lead_id: 'l1', lead_name: 'Ana Pérez', event_name: 'Purchase', status: 'skipped',
        skip_reason: 'sin moneda configurada', value: 80, currency: null, last_error: null,
        created_at: '2026-11-13T15:00:00Z', sent_at: null,
      }],
    })
    render(<MetaConversionsPanel />)

    expect(screen.getByText(/dataset 123456/)).toBeInTheDocument()
    expect(screen.getByText(/Condiciones aceptadas por Gerson/)).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Lead desde un anuncio 4 0 0 0/ })).toBeInTheDocument()
    expect(screen.getByText(/4 de 10 leads del período/)).toBeInTheDocument()
    expect(screen.getByText(/Omitido: sin moneda configurada/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apagar' }))
    expect(mocks.save).toHaveBeenCalledWith({ enabled: false }, expect.anything())
  })

  it('guarda el código de prueba sin volver a pedir la aceptación', async () => {
    const user = userEvent.setup()
    mocks.data = status({ enabled: true })
    render(<MetaConversionsPanel />)

    await user.type(screen.getByLabelText(/Código de prueba/), 'TEST123')
    await user.click(screen.getByRole('button', { name: 'Guardar código' }))
    expect(mocks.save).toHaveBeenCalledWith({ enabled: true, test_event_code: 'TEST123' }, expect.anything())
  })
})
