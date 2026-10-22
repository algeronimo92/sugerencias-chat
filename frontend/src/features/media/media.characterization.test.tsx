/**
 * Caracterización de la biblioteca de archivos (fase 0 del refactor).
 *
 * Fija lo que hoy hace la biblioteca contra un backend falso: listar y
 * filtrar, subir (con el tope de 25 MB), renombrar conservando la extensión,
 * borrar (y no borrar lo que usa una plantilla) y elegir desde el selector.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryClient } from '../../shared/queryClient'
import { installFakeApi } from '../../test/fakeApi'
import { MediaLibraryPage } from './components/MediaLibraryPage'
import { MediaLibraryPicker } from './components/MediaLibraryPicker'
import type { MediaAsset } from './types'

const api = installFakeApi()

function asset(overrides: Partial<MediaAsset> & { id: number; filename: string }): MediaAsset {
  return {
    media_url: `/media/${overrides.filename}`,
    content_type: 'image/png',
    size_bytes: 2048,
    uploaded_by_user_id: 1,
    uploaded_by_name: 'Admin',
    created_at: '2026-10-01T10:00:00Z',
    use_count: 0,
    ...overrides,
  }
}

const PHOTO = asset({ id: 1, filename: 'promo.png' })
const PRICES = asset({ id: 2, filename: 'precios.pdf', content_type: 'application/pdf' })
const IN_USE = asset({ id: 3, filename: 'logo.png', use_count: 2 })

// La biblioteca usa el QueryClient compartido de la app (no el del provider),
// así que se monta con ese mismo y se limpia entre tests.
function mount(ui: ReactNode) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  queryClient.clear()
  api.current.on('get', '/api/media-library', { data: [PHOTO, PRICES, IN_USE] })
})

describe('biblioteca', () => {
  it('lista los archivos y filtra por tipo en el servidor', async () => {
    mount(<MediaLibraryPage />)

    expect(await screen.findByText('promo.png')).toBeInTheDocument()
    expect(screen.getByText('3 resultados')).toBeInTheDocument()

    api.current.on('get', '/api/media-library', request => ({
      data: request.params.kind === 'document' ? [PRICES] : [PHOTO, PRICES, IN_USE],
    }))
    await userEvent.click(screen.getByRole('button', { name: 'Documentos' }))

    expect(await screen.findByText('1 resultado')).toBeInTheDocument()
    expect(api.current.calls('get', '/api/media-library').at(-1)?.params).toMatchObject({ kind: 'document' })
  })

  it('busca por nombre en el servidor', async () => {
    mount(<MediaLibraryPage />)
    await screen.findByText('promo.png')

    await userEvent.type(screen.getByPlaceholderText('Buscar por nombre o tipo'), 'precios')

    await waitFor(() => expect(api.current.calls('get', '/api/media-library').at(-1)?.params).toMatchObject({ search: 'precios' }))
  })

  it('sube un archivo en base64 y refresca la lista', async () => {
    api.current.on('post', '/api/media-library', { data: asset({ id: 9, filename: 'nuevo.png' }) })
    const { container } = mount(<MediaLibraryPage />)
    await screen.findByText('promo.png')
    const before = api.current.calls('get', '/api/media-library').length

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    await userEvent.upload(input, new File(['hola'], 'nuevo.png', { type: 'image/png' }))

    await waitFor(() => expect(api.current.calls('post', '/api/media-library')).toHaveLength(1))
    expect(api.current.calls('post', '/api/media-library')[0].body).toEqual({
      content_type: 'image/png', data_base64: btoa('hola'), filename: 'nuevo.png',
    })
    await waitFor(() => expect(api.current.calls('get', '/api/media-library').length).toBeGreaterThan(before))
  })

  it('no sube un archivo de más de 25 MB', async () => {
    const { container } = mount(<MediaLibraryPage />)
    await screen.findByText('promo.png')

    const big = new File(['x'], 'enorme.mp4', { type: 'video/mp4' })
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 })
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, big)

    expect(await screen.findByText('enorme.mp4 supera el máximo de 25 MB')).toBeInTheDocument()
    expect(api.current.calls('post', '/api/media-library')).toEqual([])
  })

  it('renombra sin tocar la extensión', async () => {
    api.current.on('patch', '/api/media-library/1', { data: { ...PHOTO, filename: 'promo-octubre.png' } })
    mount(<MediaLibraryPage />)
    await screen.findByText('promo.png')

    await userEvent.click(screen.getAllByRole('button', { name: 'Cambiar nombre' })[0])
    const name = screen.getByLabelText('Nombre')
    expect(screen.getByLabelText('Extensión')).toHaveValue('.png')
    await userEvent.clear(name)
    await userEvent.type(name, 'promo-octubre')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }))

    await waitFor(() => expect(api.current.calls('patch', '/api/media-library/1')).toHaveLength(1))
    expect(api.current.calls('patch', '/api/media-library/1')[0].body).toEqual({ filename: 'promo-octubre.png' })
  })

  it('borra un archivo libre tras confirmar', async () => {
    api.current.on('get', '/api/media-library', { data: [PRICES] })
    api.current.on('delete', '/api/media-library/2', { status: 204 })
    mount(<MediaLibraryPage />)
    await screen.findByText('precios.pdf')

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar archivo' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/precios.pdf/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar archivo' }))

    await waitFor(() => expect(api.current.calls('delete', '/api/media-library/2')).toHaveLength(1))
  })

  it('no borra un archivo que usa una plantilla', async () => {
    mount(<MediaLibraryPage />)
    await screen.findByText('logo.png')

    await userEvent.click(screen.getByRole('button', { name: 'Usado en 2 plantilla(s)' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Entendido' }))

    expect(api.current.requests.filter(request => request.method === 'delete')).toEqual([])
  })
})

describe('selector de la biblioteca', () => {
  it('entrega el archivo elegido y respeta los ya agregados', async () => {
    const onSelect = vi.fn()
    mount(
      <MediaLibraryPicker selectedIds={new Set()} disabledIds={new Set([2])} canSelect onSelect={onSelect} onClose={() => {}} />,
    )

    await userEvent.click(await screen.findByTitle('Agregar promo.png'))
    expect(onSelect).toHaveBeenCalledWith(PHOTO)
    expect(screen.getByTitle('Este archivo ya está en la plantilla')).toBeDisabled()
  })

  it('al llegar al límite no deja agregar más', async () => {
    mount(
      <MediaLibraryPicker selectedIds={new Set()} disabledIds={new Set()} canSelect={false} onSelect={vi.fn()} onClose={() => {}} />,
    )

    expect(await screen.findByText('Alcanzaste el límite de adjuntos de esta plantilla.')).toBeInTheDocument()
    await screen.findByText('promo.png')
    expect(screen.getAllByTitle('Se alcanzó el límite de adjuntos')[0]).toBeDisabled()
  })
})
