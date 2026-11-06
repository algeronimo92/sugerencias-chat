import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MediaAsset } from '../../media/types'
import { AiResourcesPanel } from './AiResourcesPanel'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }))

vi.mock('../../../shared/http/client', () => ({ default: api }))

function asset(partial: Partial<MediaAsset> & Pick<MediaAsset, 'id' | 'filename' | 'content_type'>): MediaAsset {
  return {
    media_url: `/media/${partial.filename}`,
    size_bytes: 1_300_000,
    uploaded_by_user_id: 1,
    uploaded_by_name: 'Ana',
    created_at: '2026-10-01T10:00:00Z',
    use_count: 0,
    ai_description: null,
    ...partial,
  }
}

const flyer = asset({ id: 1, filename: 'promo-octubre.jpg', content_type: 'image/jpeg', ai_description: 'Promo de octubre de limpieza facial', created_at: '2026-10-01T10:00:00Z' })
const video = asset({ id: 2, filename: 'VID-20251003-WA0012.mp4', content_type: 'video/mp4', created_at: '2026-10-03T10:00:00Z' })
const pdf = asset({ id: 3, filename: 'catalogo.pdf', content_type: 'application/pdf', created_at: '2026-09-20T10:00:00Z' })

/** La primera pintura con la suite entera en marcha puede pasar del segundo
 *  que espera findAllByRole por defecto; se espera al nombre del video. */
async function waitForRows() {
  await screen.findByText('VID-20251003-WA0012.mp4', undefined, { timeout: 5000 })
  return screen.getAllByRole('listitem')
}

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><AiResourcesPanel /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AiResourcesPanel', () => {
  beforeEach(() => {
    for (const method of Object.values(api)) method.mockReset()
    // La biblioteca refleja lo que se guardó: al refrescar tras el PATCH, el
    // backend real devuelve la descripción nueva.
    let library = [flyer, video, pdf]
    api.get.mockImplementation((url: string) => {
      if (url === '/api/media-library') return Promise.resolve({ data: library })
      return Promise.reject(new Error(`GET inesperado ${url}`))
    })
    api.patch.mockImplementation((url: string, body: { ai_description: string }) => {
      const id = Number(url.split('/').at(-1))
      library = library.map(item => (item.id === id ? { ...item, ai_description: body.ai_description || null } : item))
      return Promise.resolve({ data: library.find(item => item.id === id) })
    })
  })

  it('muestra cada archivo con su vista previa, su tipo y si el asistente lo ve', async () => {
    renderPanel()

    const rows = await waitForRows()
    // Lo más reciente primero: el video (3 de octubre) antes que el flyer (1 de octubre).
    expect(rows[0]).toHaveTextContent('VID-20251003-WA0012.mp4')
    expect(within(rows[0]).getByRole('button', { name: 'Ver VID-20251003-WA0012.mp4' })).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent('Oculto para el asistente')
    expect(rows[0]).toHaveTextContent(/Video · 1[.,]2 MB/)

    expect(within(rows[1]).getByRole('img', { name: 'promo-octubre.jpg' })).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('Visible para el asistente')

    // Un PDF no tiene visor: se abre en otra pestaña.
    const link = within(rows[2]).getByRole('link', { name: 'Abrir catalogo.pdf en otra pestaña' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(rows[2]).toHaveTextContent('PDF')
  })

  it('filtra los archivos sin describir y muestra los contadores', async () => {
    const user = userEvent.setup()
    renderPanel()

    const pending = await screen.findByRole('button', { name: /Sin describir/ })
    expect(pending).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: /Visibles/ })).toHaveTextContent('1')

    await user.click(pending)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(screen.queryByText('promo-octubre.jpg')).not.toBeInTheDocument()
  })

  it('guarda la descripción al salir del campo y marca el archivo como visible', async () => {
    const user = userEvent.setup()
    renderPanel()

    const rows = await waitForRows()
    const field = within(rows[0]).getByLabelText('Cuándo enviarlo')
    await user.type(field, 'Testimonio de una paciente de botox ')
    expect(rows[0]).toHaveTextContent('Sin guardar')

    await user.tab()

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/ai/resources/2', { ai_description: 'Testimonio de una paciente de botox' }))
    expect(await within(rows[0]).findByText('Guardado')).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent('Visible para el asistente')
  })

  it('no llama al backend si la descripción no cambió', async () => {
    const user = userEvent.setup()
    renderPanel()

    const rows = await waitForRows()
    await user.click(within(rows[1]).getByLabelText('Cuándo enviarlo'))
    await user.tab()

    expect(api.patch).not.toHaveBeenCalled()
  })

  it('ofrece reintentar cuando el guardado falla', async () => {
    api.patch.mockRejectedValueOnce(new Error('Sin conexión'))
    const user = userEvent.setup()
    renderPanel()

    const rows = await waitForRows()
    await user.type(within(rows[0]).getByLabelText('Cuándo enviarlo'), 'Video del antes y después')
    await user.tab()

    expect(await within(rows[0]).findByText(/No se guardó/)).toBeInTheDocument()
    await user.click(within(rows[0]).getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2))
    expect(await within(rows[0]).findByText('Guardado')).toBeInTheDocument()
  })

  it('invita a subir archivos cuando la biblioteca está vacía', async () => {
    api.get.mockResolvedValue({ data: [] })
    renderPanel()

    expect(await screen.findByText('Aún no hay archivos')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir a Archivos' })).toHaveAttribute('href', '/media-library')
  })
})
