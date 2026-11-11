import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PlatformApp } from './PlatformApp'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))

vi.mock('../../../shared/http/client', () => ({ default: api }))
vi.mock('../../../shared/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }) }))

const organizations = [
  { id: '1', name: 'DermicaPro', status: 'active', schema_name: 'tenant_1', storage_prefix: 'tenant-1', created_at: null, revision: 'abc', migration_status: 'ok', up_to_date: true, ai_enabled: true, ai_monthly_quota: null, domains: [{ id: 'd1', hostname: 'dermicapro.localhost', is_primary: true }] },
  { id: '2', name: 'Clínica Piloto', status: 'active', schema_name: 'tenant_2', storage_prefix: 'tenant-2', created_at: null, revision: 'abc', migration_status: 'ok', up_to_date: true, ai_enabled: false, ai_monthly_quota: 0, domains: [{ id: 'd2', hostname: 'piloto.localhost', is_primary: true }] },
]

const platformSettings = [
  { key: 'meta_app_id', label: 'App ID', group: 'meta', secret: false, configured: true, source: 'platform', value: 'APP123' },
  { key: 'meta_app_secret', label: 'App Secret', group: 'meta', secret: true, configured: true, source: 'platform', value: null },
]

const citasIntegrations = [
  { key: 'n8n_citas_webhook_url', label: 'Citas (n8n): URL del webhook', configured: true, value: 'https://n8n.test/citas' },
]

const overview = {
  users: 3,
  setup: {
    steps: [
      { key: 'whatsapp', done: true, optional: false },
      { key: 'team', done: false, optional: false },
      { key: 'services', done: false, optional: false },
      { key: 'google_calendar', done: false, optional: false },
      { key: 'templates', done: false, optional: true },
    ],
    completed: 1,
    total: 4,
    all_done: false,
    dismissed: false,
  },
}

function renderPanel() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PlatformApp /></QueryClientProvider>)
}

describe('PlatformApp', () => {
  beforeEach(() => {
    // La pantalla abierta queda en el hash: cada prueba arranca en el directorio.
    window.history.replaceState(null, '', '/')
    api.get.mockReset()
    api.post.mockReset()
    api.put.mockReset()
    api.delete.mockReset()
    api.get.mockImplementation((url: string) => {
      if (url === '/api/platform/auth/me') return Promise.resolve({ data: { id: 'op', name: 'Gerson', email: 'op@example.com' } })
      if (url === '/api/platform/settings') return Promise.resolve({ data: platformSettings })
      if (url === '/api/platform/organizations/1/overview') return Promise.resolve({ data: overview })
      if (url === '/api/platform/organizations/1/ai') return Promise.resolve({ data: { enabled: true, monthly_quota: null, used_this_month: 12 } })
      if (url === '/api/platform/organizations/1/integrations') return Promise.resolve({ data: citasIntegrations })
      if (url === '/api/platform/knowledge-templates') return Promise.resolve({ data: [] })
      if (url === '/api/platform/email') return Promise.resolve({ data: { source: null, host: '', port: 587, security: 'starttls', username: '', password_configured: false, from_address: '', from_name: '', environment_host: null, environment_from_address: null } })
      return Promise.resolve({ data: { head: 'abc', items: organizations } })
    })
    api.post.mockResolvedValue({ data: {} })
    api.put.mockResolvedValue({ data: platformSettings })
  })

  it('muestra el mismo estado de backend no disponible que el CRM y permite reintentar', async () => {
    const user = userEvent.setup()
    api.get.mockRejectedValueOnce(new Error('Network Error'))

    renderPanel()

    expect(await screen.findByRole('heading', { name: 'Backend no disponible' })).toBeInTheDocument()
    expect(screen.getByText('El frontend está funcionando, pero no pudo consultar tu sesión en el servidor.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar conexión' }))
    await waitFor(() => expect(
      api.get.mock.calls.filter(([url]) => url === '/api/platform/auth/me'),
    ).toHaveLength(2))
  })

  it('el directorio filtra por dominio y cada negocio se administra en su propio espacio', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByRole('link', { name: 'DermicaPro' })
    // En el directorio no hay nada que guardar: solo se elige un negocio.
    expect(screen.queryByRole('textbox', { name: 'Nuevo dominio' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suspender' })).not.toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Buscar negocio o dominio' }), 'piloto.localhost')
    expect(screen.getByText('1 de 2 negocios')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'DermicaPro' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Clínica Piloto' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Clínica Piloto' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#negocios/2')
    expect(screen.getByRole('link', { name: 'Resumen' })).toHaveAttribute('aria-current', 'page')
  })

  it('confirma antes de suspender el negocio abierto', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/#negocios/2')
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Suspender' }))
    expect(screen.getByRole('alertdialog', { name: 'Suspender Clínica Piloto' })).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(api.post).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Suspender' }))
    await user.click(screen.getByRole('button', { name: 'Suspender negocio' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/platform/organizations/2/suspend'))
  })

  it('el resumen muestra la puesta en marcha y el uso del negocio abierto', async () => {
    window.history.replaceState(null, '', '/#negocios/1')
    renderPanel()

    expect(await screen.findByText('1 de 4')).toBeInTheDocument()
    expect(screen.getByText('WhatsApp conectado').closest('li')).toHaveTextContent('Listo')
    expect(screen.getByText('Equipo invitado').closest('li')).toHaveTextContent('Pendiente')
    expect(screen.getByText('personas en el equipo').closest('p')).toHaveTextContent('3')
    expect(await screen.findByText('generaciones de IA este mes')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/api/platform/organizations/1/overview')
    expect(api.get).not.toHaveBeenCalledWith('/api/platform/organizations/2/overview')
  })

  it('un enlace abre el apartado de ese negocio y cambiar de negocio lo conserva', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/#negocios/1/dominios')
    renderPanel()

    expect(await screen.findByRole('heading', { level: 1, name: 'DermicaPro' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Nuevo dominio' })).toBeInTheDocument()
    expect(screen.getByText('dermicapro.localhost', { selector: 'li span' })).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Cambiar de negocio' }), 'Clínica Piloto')
    expect(await screen.findByRole('heading', { level: 1, name: 'Clínica Piloto' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#negocios/2/dominios')
    expect(screen.getByText('piloto.localhost', { selector: 'li span' })).toBeInTheDocument()
    expect(screen.queryByText('dermicapro.localhost', { selector: 'li span' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Negocios', current: false }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Negocios' })).toBeInTheDocument()
  })

  it('avisa cuando el enlace apunta a un negocio que no existe', async () => {
    window.history.replaceState(null, '', '/#negocios/999/marca')
    renderPanel()

    expect(await screen.findByRole('heading', { name: 'Negocio no encontrado' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver a negocios' })).toHaveAttribute('href', '#negocios')
  })

  it('agrupa las credenciales por app y reemplaza secretos sin recibir el valor guardado', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('link', { name: 'Integraciones' }))
    await screen.findByDisplayValue('APP123')
    expect(screen.getByRole('heading', { name: 'Meta · Tech Provider' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Correo de la plataforma' })).toBeInTheDocument()
    const secret = screen.getByLabelText('App Secret', { selector: 'input' })
    expect(secret).toHaveValue('')
    expect(secret).toHaveAttribute('placeholder', '•••• sin cambios')

    await user.type(secret, 'rotated-secret')
    await user.click(screen.getByRole('button', { name: 'Guardar Meta · Tech Provider' }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/platform/settings', {
      values: { meta_app_id: 'APP123', meta_app_secret: 'rotated-secret' },
    }))
  })

  it('fija la cuota del asistente e integra los workflows del negocio desde su espacio', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByRole('link', { name: 'DermicaPro' })
    expect(screen.getByText('IA deshabilitada')).toBeInTheDocument()
    expect(screen.getByText('IA sin límite')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'DermicaPro' }))
    await user.click(await screen.findByRole('link', { name: 'Asistente IA' }))

    expect(await screen.findByText(/Este mes:/)).toHaveTextContent('Este mes: 12 generaciones')
    await user.type(screen.getByLabelText('Cuota mensual'), '100')
    await user.click(screen.getByRole('button', { name: 'Guardar asistente' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/platform/organizations/1/ai', {
      enabled: true,
      monthly_quota: 100,
    }))

    await user.click(screen.getByRole('link', { name: 'Integraciones propias' }))
    const citas = await screen.findByDisplayValue('https://n8n.test/citas')
    await user.clear(citas)
    await user.type(citas, 'https://n8n.test/citas-v2')
    await user.click(screen.getByRole('button', { name: 'Guardar integraciones' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/platform/organizations/1/integrations', {
      values: { n8n_citas_webhook_url: 'https://n8n.test/citas-v2' },
    }))
  })
})
