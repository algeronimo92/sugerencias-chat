import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeTemplatesPanel } from './KnowledgeTemplatesPanel'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('../../../shared/http/client', () => ({ default: api }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const TEMPLATE = { id: 1, title: 'Ficha Hollywood Peel', document_type: 'ficha', service_hint: 'Hollywood Peel', content: 'Texto', is_active: true, version: 3, updated_at: '' }

function renderPanel() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><KnowledgeTemplatesPanel /></QueryClientProvider>)
}

describe('KnowledgeTemplatesPanel', () => {
  beforeEach(() => {
    for (const method of Object.values(api)) method.mockReset()
    api.get.mockResolvedValue({ data: [TEMPLATE] })
    api.post.mockImplementation((_url: string, body: object) => Promise.resolve({ data: { id: 2, version: 1, updated_at: '', ...body } }))
    api.put.mockImplementation((_url: string, body: object) => Promise.resolve({ data: { ...TEMPLATE, ...body, version: 4 } }))
  })

  it('lista las plantillas con tipo, servicio sugerido y versión', async () => {
    renderPanel()
    await screen.findByText('Ficha Hollywood Peel')
    const list = screen.getByRole('list', { name: 'Plantillas de conocimiento' })
    expect(list).toHaveTextContent('Ficha del servicio · Hollywood Peel · versión 3')
  })

  it('crea una plantilla nueva', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Nueva plantilla' }))
    await user.type(screen.getByLabelText('Título'), 'FAQ láser')
    await user.type(screen.getByLabelText('Servicio sugerido'), 'Depilación láser')
    await user.type(screen.getByLabelText('Contenido'), '¿Duele? Un poco.')
    await user.click(screen.getByRole('button', { name: 'Crear plantilla' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/platform/knowledge-templates', {
      title: 'FAQ láser', document_type: 'ficha', service_hint: 'Depilación láser', content: '¿Duele? Un poco.', is_active: true,
    }))
  })

  it('edita y oculta una plantilla', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Editar plantilla Ficha Hollywood Peel' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/platform/knowledge-templates/1', expect.objectContaining({ is_active: false, title: 'Ficha Hollywood Peel' })))
  })
})
