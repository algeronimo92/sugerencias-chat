import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PlatformApp } from './PlatformApp'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))

vi.mock('../api/client', () => ({ default: api }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }) }))

const organizations = [
  { id: '1', name: 'DermicaPro', status: 'active', schema_name: 'tenant_1', storage_prefix: 'tenant-1', created_at: null, revision: 'abc', migration_status: 'ok', up_to_date: true, ai_enabled: true, ai_monthly_quota: null, domains: [{ id: 'd1', hostname: 'dermicapro.localhost', is_primary: true }] },
  { id: '2', name: 'Clínica Piloto', status: 'active', schema_name: 'tenant_2', storage_prefix: 'tenant-2', created_at: null, revision: 'abc', migration_status: 'ok', up_to_date: true, ai_enabled: false, ai_monthly_quota: 0, domains: [{ id: 'd2', hostname: 'piloto.localhost', is_primary: true }] },
]

const platformSettings = [
  { key: 'meta_app_id', label: 'Facebook App ID (Tech Provider)', secret: false, configured: true, source: 'platform', value: 'APP123' },
  { key: 'meta_app_secret', label: 'Facebook App Secret', secret: true, configured: true, source: 'platform', value: null },
]

const citasIntegrations = [
  { key: 'n8n_citas_webhook_url', label: 'Citas (n8n): URL del webhook', configured: true, value: 'https://n8n.test/citas' },
]

describe('PlatformApp', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.put.mockReset()
    api.delete.mockReset()
    api.get.mockImplementation((url: string) => {
      if (url === '/api/platform/auth/me') return Promise.resolve({ data: { id: 'op', name: 'Gerson', email: 'op@example.com' } })
      if (url === '/api/platform/settings') return Promise.resolve({ data: platformSettings })
      if (url === '/api/platform/organizations/1/ai') return Promise.resolve({ data: { enabled: true, monthly_quota: null, used_this_month: 12 } })
      if (url === '/api/platform/organizations/1/integrations') return Promise.resolve({ data: citasIntegrations })
      return Promise.resolve({ data: { head: 'abc', items: organizations } })
    })
    api.post.mockResolvedValue({ data: {} })
    api.put.mockResolvedValue({ data: platformSettings })
  })

  it('muestra el mismo estado de backend no disponible que el CRM y permite reintentar', async () => {
    const user = userEvent.setup()
    api.get.mockRejectedValueOnce(new Error('Network Error'))

    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PlatformApp /></QueryClientProvider>)

    expect(await screen.findByRole('heading', { name: 'Backend no disponible' })).toBeInTheDocument()
    expect(screen.getByText('El frontend está funcionando, pero no pudo consultar tu sesión en el servidor.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar conexión' }))
    await waitFor(() => expect(
      api.get.mock.calls.filter(([url]) => url === '/api/platform/auth/me'),
    ).toHaveLength(2))
  })

  it('filtra por dominio y confirma antes de suspender un negocio', async () => {
    const user = userEvent.setup()
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PlatformApp /></QueryClientProvider>)

    await screen.findByText('DermicaPro')
    await user.type(screen.getByRole('textbox', { name: 'Buscar negocio o dominio' }), 'piloto.localhost')
    expect(screen.getByText('1 de 2 negocios')).toBeInTheDocument()
    expect(screen.queryByText('DermicaPro')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Nuevo dominio' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Suspender' }))
    expect(screen.getByRole('alertdialog', { name: 'Suspender Clínica Piloto' })).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(api.post).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Suspender' }))
    await user.click(screen.getByRole('button', { name: 'Suspender negocio' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/platform/organizations/2/suspend'))
  })

  it('reemplaza secretos globales sin recibir el valor guardado', async () => {
    const user = userEvent.setup()
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PlatformApp /></QueryClientProvider>)

    await screen.findByDisplayValue('APP123')
    const secret = screen.getByLabelText(/Facebook App Secret/, { selector: 'input' })
    expect(secret).toHaveValue('')
    expect(secret).toHaveAttribute('placeholder', '•••• sin cambios')

    await user.type(secret, 'rotated-secret')
    await user.click(screen.getByRole('button', { name: 'Guardar credenciales' }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/platform/settings', {
      values: { meta_app_id: 'APP123', meta_app_secret: 'rotated-secret' },
    }))
  })

  it('fija la cuota del asistente e integra los workflows del negocio desde la plataforma', async () => {
    const user = userEvent.setup()
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PlatformApp /></QueryClientProvider>)

    await screen.findByText('DermicaPro')
    expect(screen.getByText('IA deshabilitada')).toBeInTheDocument()
    await user.click(screen.getByText('IA sin límite'))

    expect(await screen.findByText(/Este mes:/)).toHaveTextContent('Este mes: 12 generaciones')
    const cuota = screen.getAllByLabelText('Cuota mensual')[0]
    await user.type(cuota, '100')
    await user.click(screen.getAllByRole('button', { name: 'Guardar asistente' })[0])
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/platform/organizations/1/ai', {
      enabled: true,
      monthly_quota: 100,
    }))

    const citas = await screen.findByDisplayValue('https://n8n.test/citas')
    await user.clear(citas)
    await user.type(citas, 'https://n8n.test/citas-v2')
    await user.click(screen.getAllByRole('button', { name: 'Guardar integraciones' })[0])
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/platform/organizations/1/integrations', {
      values: { n8n_citas_webhook_url: 'https://n8n.test/citas-v2' },
    }))
  })
})
