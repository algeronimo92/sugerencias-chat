import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Chat } from '../types'
import { LeadInfo } from './LeadInfo'

const mocks = vi.hoisted(() => ({ updateLead: vi.fn(), moveStage: vi.fn() }))

vi.mock('../queries', () => ({
  useUpdateLead: () => ({ mutateAsync: mocks.updateLead, isPending: false }),
  useMarkNoShow: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../kanban-queries', () => ({
  useMoveLeadStage: () => ({ mutateAsync: mocks.moveStage, isPending: false }),
}))
vi.mock('../../catalogs/public/useCustomFields', () => ({
  useCustomFields: () => ({ data: [] }),
}))
vi.mock('../hooks/useLeadCustomFieldValues', () => ({
  useLeadCustomFieldValues: () => ({ data: {} }),
  useUpdateLeadCustomFieldValues: () => ({ mutate: vi.fn(), isPending: false }),
}))
// Las etapas son del negocio; la ficha solo necesita rotular la del lead.
vi.mock('../hooks/useLeadStages', async () => {
  const { buildStageCatalog, DEFAULT_LEAD_STAGES } = await import('../domain/leadStageMeta')
  return { useLeadStageCatalog: () => buildStageCatalog(DEFAULT_LEAD_STAGES) }
})

// El formulario completo tiene su propio test; acá alcanza con ver qué recibe.
vi.mock('./LeadFormDialog', () => ({
  LeadFormDialog: ({ highlightService, onCancel, onSubmit }: { highlightService?: { reason: string | null }; onCancel: () => void; onSubmit: (values: object, stage: string) => void }) => (
    <div role="dialog" aria-label="Editar lead">
      {highlightService ? `resaltado: ${highlightService.reason}` : 'sin resaltar'}
      <button type="button" onClick={onCancel}>Cerrar</button>
      <button type="button" onClick={() => onSubmit({ razon_perdido: null }, 'calificado')}>Guardar prueba</button>
    </div>
  ),
}))

function CurrentSearch() {
  return <output aria-label="búsqueda actual">{useLocation().search}</output>
}

describe('LeadInfo', () => {
  beforeEach(() => {
    mocks.updateLead.mockReset().mockResolvedValue({ chat_id: 'lead-1' })
    mocks.moveStage.mockReset().mockResolvedValue({ chat_id: 'lead-1', stage: 'calificado' })
  })

  it('muestra el username de Meta cuando existe', () => {
    const chat = {
      chat_id: 'af36fbfb-870b-4d02-b67e-4bf1fa17f97e',
      username: '@gporta.21',
      name: 'Gerson Portal',
      phone: '51911111111',
      secondary_phone: null,
      stage: 'nuevo',
      conversacion_abierta: true,
      tags: [],
    } as unknown as Chat

    render(<MemoryRouter><LeadInfo chat={chat} /></MemoryRouter>)

    expect(screen.getByText('Username')).toBeInTheDocument()
    expect(screen.getByText('@gporta.21')).toBeInTheDocument()
    expect(screen.getByText('Nuevo')).toBeInTheDocument()
  })

  it('abre el editor con el servicio resaltado si se llega con ?editar=servicio_interes, y lo quita al cerrar', async () => {
    const chat = { chat_id: 'lead-1', name: 'Lucía', phone: '519', stage: 'nuevo', servicio_interes: 'Botox', tags: [] } as unknown as Chat
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/chat/lead-1?editar=servicio_interes&motivo=Para+eliminar+Botox']}>
        <LeadInfo chat={chat} />
        <CurrentSearch />
      </MemoryRouter>,
    )

    expect(screen.getByRole('dialog', { name: 'Editar lead' })).toHaveTextContent('resaltado: Para eliminar Botox')

    await user.click(screen.getByRole('button', { name: 'Cerrar' }))

    expect(screen.queryByRole('dialog', { name: 'Editar lead' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('búsqueda actual')).toHaveTextContent('')
  })

  it('guarda los datos y mueve la etapa elegida con el flujo de etapas', async () => {
    const chat = { chat_id: 'lead-1', name: 'Lucía', phone: '519', stage: 'nuevo', tags: [] } as unknown as Chat
    const user = userEvent.setup()
    render(<MemoryRouter><LeadInfo chat={chat} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: 'Editar lead' }))
    await user.click(screen.getByRole('button', { name: 'Guardar prueba' }))

    await waitFor(() => expect(mocks.moveStage).toHaveBeenCalledWith({
      chatId: 'lead-1',
      stage: 'calificado',
      razonPerdido: null,
    }))
    expect(mocks.updateLead).toHaveBeenCalledWith({ razon_perdido: null })
    expect(screen.queryByRole('dialog', { name: 'Editar lead' })).not.toBeInTheDocument()
  })
})
