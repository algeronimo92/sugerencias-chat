import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { saveTemplateDraft } from '../domain/templateDraftStorage'
import { EMPTY_TEMPLATE_FORM } from '../domain/templateForm'
import type { MessageTemplate } from '../types'
import { TemplatesPage } from './TemplatesPage'

const mocks = vi.hoisted(() => ({ templates: [] as unknown[], update: vi.fn() }))

vi.mock('../hooks/useTemplates', () => ({
  useTemplates: () => ({ data: mocks.templates, isLoading: false, isError: false, refetch: vi.fn() }),
  useTemplateCapabilities: () => ({ data: { official_sending_supported: true, reason: null } }),
  useUpdateTemplate: () => ({ mutate: mocks.update, isPending: false }),
  useDeleteTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useSyncTemplate: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../hooks/useTemplateCategories', () => ({ useTemplateCategories: () => ({ data: [] }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('./ImportMetaTemplatesDialog', () => ({ ImportMetaTemplatesDialog: () => null }))

function template(overrides: Partial<MessageTemplate>): MessageTemplate {
  return {
    id: 1, name: 'Saludo', content: 'Hola', shortcut: null, category: 'ventas', template_type: 'internal', interactive_type: 'none',
    official_status: null, official_category: null, official_rejected_reason: null, official_name: null, meta_template_id: null,
    imported_from_meta: false, visibility: 'global', attachments: [], is_active: true, use_count: 0,
    ...overrides,
  } as MessageTemplate
}

const rows = () => screen.getAllByRole('listitem')

describe('TemplatesPage', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.update.mockReset()
    mocks.templates = [
      template({ id: 1, name: 'slogan hifu12d', shortcut: 'hifu-12d', content: 'El *HIFU 12D* es un tratamiento', use_count: 2938 }),
      template({ id: 2, name: 'aviso_cita_cliente', template_type: 'official', official_status: 'APPROVED', official_category: 'UTILITY', category: 'Seguimiento', use_count: 1 }),
      template({ id: 3, name: 'Recordatorio de pago', template_type: 'official', official_status: 'REJECTED', official_category: 'UTILITY', official_rejected_reason: 'TAG_CONTENT_MISMATCH' }),
    ]
  })

  it('muestra el estado de Meta en español, con el motivo de rechazo, y las más usadas primero', () => {
    render(<MemoryRouter><TemplatesPage /></MemoryRouter>)

    expect(rows().map(row => within(row).getAllByRole('link')[0].textContent)).toEqual(['slogan hifu12d', 'aviso_cita_cliente', 'Recordatorio de pago'])
    expect(within(rows()[1]).getByText('Aprobada')).toBeInTheDocument()
    expect(within(rows()[1]).getByText('Oficial · Aviso')).toBeInTheDocument()
    expect(within(rows()[2]).getByText('Rechazada')).toBeInTheDocument()
    expect(within(rows()[2]).getByText(/el texto no coincide con el tipo de mensaje elegido/)).toBeInTheDocument()
    // El texto se muestra sin las marcas de formato de WhatsApp.
    expect(within(rows()[0]).getByText('El HIFU 12D es un tratamiento')).toBeInTheDocument()
    expect(screen.queryByText('APPROVED')).not.toBeInTheDocument()
  })

  it('busca y filtra, y ofrece quitar los filtros cuando no queda nada', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><TemplatesPage /></MemoryRouter>)

    await user.type(screen.getByRole('searchbox', { name: 'Buscar plantillas' }), 'hifu')
    expect(rows()).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /^Oficiales/ }))
    expect(screen.getByText('Ninguna plantilla coincide con «hifu»')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }))
    expect(rows()).toHaveLength(3)
  })

  it('activar o desactivar es un interruptor con nombre', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><TemplatesPage /></MemoryRouter>)

    await user.click(screen.getByRole('switch', { name: 'slogan hifu12d: plantilla activa' }))
    expect(mocks.update).toHaveBeenCalledWith({ id: 1, is_active: false }, expect.anything())
  })

  it('marca la plantilla con cambios sin enviar y deja descartarlos', async () => {
    const user = userEvent.setup()
    saveTemplateDraft(2, { form: { ...EMPTY_TEMPLATE_FORM, name: 'aviso_cita_cliente', content: 'Texto a medias' }, officialNameEdited: true, savedAt: Date.now() })
    render(<MemoryRouter><TemplatesPage /></MemoryRouter>)

    expect(within(rows()[1]).getByText('Cambios sin enviar')).toBeInTheDocument()
    expect(within(rows()[0]).queryByText('Cambios sin enviar')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Más acciones de aviso_cita_cliente' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Descartar los cambios sin enviar' }))
    expect(screen.queryByText('Cambios sin enviar')).not.toBeInTheDocument()
  })

  it('dice desde cuándo se puede volver a editar una aprobada con el cupo gastado', () => {
    mocks.templates = [template({
      id: 2, name: 'Desde Instagram', template_type: 'official', official_status: 'APPROVED', official_category: 'MARKETING',
      meta_template_id: '921', official_next_edit_at: new Date(Date.now() + 23 * 3_600_000).toISOString(),
    })]
    render(<MemoryRouter><TemplatesPage /></MemoryRouter>)

    expect(within(rows()[0]).getByText(/^Editable desde (hoy|mañana) a las/)).toBeInTheDocument()
  })

  it('ofrece retomar un borrador sin terminar', async () => {
    const user = userEvent.setup()
    saveTemplateDraft(null, { form: { ...EMPTY_TEMPLATE_FORM, name: 'Aviso de cita' }, officialNameEdited: false, savedAt: Date.now() })
    render(<MemoryRouter><TemplatesPage /></MemoryRouter>)

    expect(screen.getByText('Tienes un borrador sin terminar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(screen.queryByText('Tienes un borrador sin terminar')).not.toBeInTheDocument()
  })
})
