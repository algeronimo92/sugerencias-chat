import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgePanel } from './KnowledgePanel'
import { ServiceKnowledgeLink } from './ServiceKnowledgeLink'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('../../../shared/http/client', () => ({ default: api }))
vi.mock('sonner', () => ({ toast }))

const SERVICES = [
  { id: 3, name: 'Hollywood Peel - Rostro', is_active: true, packages: [] },
  { id: 5, name: 'Botox', is_active: true, packages: [] },
]
const DOCUMENTS = [
  { id: 'd1', title: 'Ficha Hollywood Peel', document_type: 'ficha', service_ids: [3], characters: 300, chunk_count: 1, created_at: '', updated_at: '' },
  { id: 'd2', title: 'Política de pagos', document_type: 'politica', service_ids: [], characters: 80, chunk_count: 1, created_at: '', updated_at: '' },
]

function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('KnowledgePanel', () => {
  beforeEach(() => {
    for (const method of Object.values(api)) method.mockReset()
    toast.success.mockReset()
    toast.error.mockReset()
    api.get.mockImplementation((url: string) => {
      if (url === '/api/ai/knowledge') return Promise.resolve({ data: DOCUMENTS })
      if (url === '/api/services/all') return Promise.resolve({ data: SERVICES })
      return Promise.reject(new Error(`GET inesperado ${url}`))
    })
    api.post.mockImplementation((url: string, body: Record<string, unknown>) => {
      if (url === '/api/ai/knowledge/import-pdf') {
        return Promise.resolve({ data: { title: 'Ficha Botox', content: 'Toxina botulínica. Dura cuatro meses.', pages: 2, characters: 38, truncated: false } })
      }
      return Promise.resolve({ data: { id: 'd9', characters: 10, chunk_count: 1, created_at: '', updated_at: '', ...body } })
    })
  })

  it('muestra a qué servicio pertenece cada documento y filtra por servicio', async () => {
    const user = userEvent.setup()
    wrap(<KnowledgePanel />)

    const list = await screen.findByRole('list', { name: 'Documentos de conocimiento' })
    await waitFor(() => expect(list).toHaveTextContent('Hollywood Peel - Rostro · Ficha del servicio'))
    expect(list).toHaveTextContent('Para todos los servicios · Política del negocio')
    expect(list).not.toHaveTextContent('fragmento')

    await user.click(screen.getByRole('combobox', { name: 'Filtrar por servicio' }))
    await user.click(screen.getByRole('option', { name: 'Para todos los servicios' }))
    expect(list).not.toHaveTextContent('Ficha Hollywood Peel')
    expect(list).toHaveTextContent('Política de pagos')
  })

  it('al llegar desde un servicio, lo filtra y crea el documento vinculado a él', async () => {
    const user = userEvent.setup()
    wrap(<KnowledgePanel initialServiceId={5} />)

    expect(await screen.findByText('Este servicio no tiene documentos')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nuevo' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Botox' })).toBeChecked())
    // Una ficha puede ser de varios servicios: se marca otro además del que ya venía.
    await user.click(screen.getByRole('checkbox', { name: 'Hollywood Peel - Rostro' }))

    await user.type(screen.getByLabelText('Título'), 'Ficha Botox')
    await user.type(screen.getByLabelText('Contenido'), 'Dura 4 meses.')
    await user.click(screen.getByRole('combobox', { name: 'Tipo' }))
    await user.click(screen.getByRole('option', { name: 'Ficha del servicio' }))
    await user.click(screen.getByRole('button', { name: 'Guardar documento' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/ai/knowledge', {
      title: 'Ficha Botox', content: 'Dura 4 meses.', document_type: 'ficha', service_ids: [5, 3],
    }))
  })

  it('importa el texto de un PDF para revisarlo antes de guardar', async () => {
    const user = userEvent.setup()
    wrap(<KnowledgePanel />)
    await user.click(await screen.findByRole('button', { name: 'Nuevo' }))

    const pdf = new File([new Uint8Array([37, 80, 68, 70])], 'Ficha Botox.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByTestId('knowledge-file'), { target: { files: [pdf] } })

    await waitFor(() => expect(screen.getByLabelText('Contenido')).toHaveValue('Toxina botulínica. Dura cuatro meses.'))
    expect(screen.getByLabelText('Título')).toHaveValue('Ficha Botox')
    expect(api.post).toHaveBeenCalledWith('/api/ai/knowledge/import-pdf', { filename: 'Ficha Botox.pdf', data_base64: 'JVBERg==' })
    expect(toast.success).toHaveBeenCalledWith('Texto de 2 páginas importado. Revísalo antes de guardar.', undefined)
    // Nada se guardó todavía.
    expect(api.post).not.toHaveBeenCalledWith('/api/ai/knowledge', expect.anything())
  })
})

describe('KnowledgePanel: reabrir un documento', () => {
  beforeEach(() => {
    for (const method of Object.values(api)) method.mockReset()
    api.get.mockImplementation((url: string) => {
      if (url === '/api/ai/knowledge') return Promise.resolve({ data: DOCUMENTS })
      if (url === '/api/services/all') return Promise.resolve({ data: SERVICES })
      if (url === '/api/ai/knowledge/d1') return Promise.resolve({ data: { ...DOCUMENTS[0], content: 'Usa carbón activado.' } })
      if (url === '/api/ai/knowledge/d2') return Promise.resolve({ data: { ...DOCUMENTS[1], content: 'Aceptamos Yape.' } })
      return Promise.reject(new Error(`GET inesperado ${url}`))
    })
  })

  it('muestra el servicio y el tipo guardados', async () => {
    const user = userEvent.setup()
    wrap(<KnowledgePanel />)
    await user.click(await screen.findByRole('button', { name: /Ficha Hollywood Peel/ }))

    await waitFor(() => expect(screen.getByLabelText('Contenido')).toHaveValue('Usa carbón activado.'))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Hollywood Peel - Rostro' })).toBeChecked())
    expect(screen.getByRole('checkbox', { name: 'Botox' })).not.toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Tipo' })).toHaveTextContent('Ficha del servicio')
  })

  it('el botón dice si el documento está guardado o tiene cambios', async () => {
    const user = userEvent.setup()
    wrap(<KnowledgePanel />)
    await user.click(await screen.findByRole('button', { name: /Ficha Hollywood Peel/ }))
    await waitFor(() => expect(screen.getByLabelText('Contenido')).toHaveValue('Usa carbón activado.'))

    // Recién abierto: nada que guardar.
    expect(screen.getByRole('button', { name: 'Guardado' })).toBeDisabled()
    expect(screen.queryByText('Cambios sin guardar')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Contenido'), ' Tres sesiones.')
    expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled()
  })

  it('con cambios sin guardar, cambiar de documento pide confirmar', async () => {
    const user = userEvent.setup()
    wrap(<KnowledgePanel />)
    await user.click(await screen.findByRole('button', { name: /Ficha Hollywood Peel/ }))
    await waitFor(() => expect(screen.getByLabelText('Contenido')).toHaveValue('Usa carbón activado.'))
    await user.type(screen.getByLabelText('Título'), ' (editada)')

    await user.click(screen.getByRole('button', { name: /Política de pagos/ }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Tienes cambios sin guardar' })
    await user.click(within(dialog).getByRole('button', { name: 'Seguir editando' }))
    expect(screen.getByLabelText('Título')).toHaveValue('Ficha Hollywood Peel (editada)')

    await user.click(screen.getByRole('button', { name: /Política de pagos/ }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar cambios' }))
    await waitFor(() => expect(screen.getByLabelText('Título')).toHaveValue('Política de pagos'))
  })
})

describe('ServiceKnowledgeLink', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.get.mockImplementation((url: string) => url === '/api/ai/knowledge' ? Promise.resolve({ data: DOCUMENTS }) : Promise.reject(new Error(url)))
  })

  it('cuenta las fichas del servicio y lleva a sus documentos', async () => {
    wrap(<ServiceKnowledgeLink serviceId={3} serviceName="Hollywood Peel - Rostro" />)
    const link = await screen.findByRole('link', { name: 'Ver fichas para la IA de Hollywood Peel - Rostro' })
    expect(link).toHaveTextContent('1 ficha para la IA')
    expect(link).toHaveAttribute('href', '/ai-assistant?tab=knowledge&servicio=3')
  })

  it('sin fichas invita a subir una', async () => {
    wrap(<ServiceKnowledgeLink serviceId={5} serviceName="Botox" />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Subir fichas para la IA de Botox' })).toHaveTextContent('Subir ficha para la IA'))
  })
})
