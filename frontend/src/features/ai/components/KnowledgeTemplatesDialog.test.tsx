import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeTemplatesDialog } from './KnowledgeTemplatesDialog'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('../../../shared/http/client', () => ({ default: api }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const TEMPLATES = [
  { id: 1, title: 'Ficha Hollywood Peel', document_type: 'ficha', service_hint: 'Hollywood Peel', content: 'Qué es: peeling con carbón.', version: 2, characters: 27, imported: false },
  { id: 2, title: 'Pagos y reservas', document_type: 'politica', service_hint: null, content: 'Aceptamos Yape.', version: 1, characters: 15, imported: true },
]
const SERVICES = [
  { id: 3, name: 'Hollywood Peel - Rostro', is_active: true, packages: [] },
  { id: 4, name: 'Hollywood Peel - Rostro + Cuello', is_active: true, packages: [] },
  { id: 5, name: 'Botox', is_active: true, packages: [] },
]

function renderDialog(props: Partial<React.ComponentProps<typeof KnowledgeTemplatesDialog>> = {}) {
  const onImported = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <KnowledgeTemplatesDialog preferredServiceId={null} onClose={() => {}} onImported={onImported} {...props} />
    </QueryClientProvider>,
  )
  return { onImported }
}

describe('KnowledgeTemplatesDialog', () => {
  beforeEach(() => {
    for (const method of Object.values(api)) method.mockReset()
    api.get.mockImplementation((url: string) => {
      if (url === '/api/ai/knowledge/templates') return Promise.resolve({ data: TEMPLATES })
      if (url === '/api/services') return Promise.resolve({ data: SERVICES })
      return Promise.reject(new Error(url))
    })
    api.post.mockResolvedValue({ data: { id: 'doc-7', title: 'Ficha Hollywood Peel', content: 'x', document_type: 'ficha', service_id: 3, template_id: 1, characters: 1, chunk_count: 1, created_at: '', updated_at: '' } })
  })

  it('propone el servicio que mejor coincide y crea una copia propia', async () => {
    const user = userEvent.setup()
    const { onImported } = renderDialog()

    expect(await screen.findByText('Qué es: peeling con carbón.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Vincular a mi servicio' })).toHaveTextContent('Hollywood Peel - Rostro'))
    await user.click(screen.getByRole('button', { name: 'Importar y editar' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/ai/knowledge/templates/1/import', { service_id: 3 }))
    expect(onImported).toHaveBeenCalledWith('doc-7')
  })

  it('marca las ya importadas y permite otra copia, general si no hay servicio', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(await screen.findByRole('button', { name: /Pagos y reservas/ }))
    expect(screen.getByRole('list', { name: 'Plantillas disponibles' })).toHaveTextContent('importada')
    await user.click(screen.getByRole('button', { name: 'Importar otra copia' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/ai/knowledge/templates/2/import', { service_id: null }))
  })

  it('el servicio que se está mirando gana a la sugerencia de la plantilla', async () => {
    const user = userEvent.setup()
    renderDialog({ preferredServiceId: 5 })

    await screen.findByText('Qué es: peeling con carbón.')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Vincular a mi servicio' })).toHaveTextContent('Botox'))
    await user.click(screen.getByRole('button', { name: 'Importar y editar' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/ai/knowledge/templates/1/import', { service_id: 5 }))
  })
})
