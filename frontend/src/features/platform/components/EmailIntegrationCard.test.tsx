import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readEmailConnectReturn } from '../public/emailConnectReturn'
import type { EmailSettingsStatus } from '../types'
import { EmailIntegrationCard } from './EmailIntegrationCard'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))

vi.mock('../../../shared/http/client', () => ({ default: api }))

const empty: EmailSettingsStatus = {
  configured: false, mode: null, oauth_provider: null, oauth_account_email: null,
  oauth_available: ['google', 'microsoft', 'zoho'], platform_available: true,
  host: '', port: 587, security: 'starttls', username: '', password_configured: false,
  from_address: '', from_name: '',
}
const smtp: EmailSettingsStatus = {
  ...empty, configured: true, mode: 'smtp', host: 'smtp.hostinger.com', port: 465, security: 'ssl',
  username: 'ventas@acme.com', password_configured: true, from_address: 'ventas@acme.com', from_name: 'Acme',
}
const oauth: EmailSettingsStatus = {
  ...empty, configured: true, mode: 'oauth', oauth_provider: 'zoho', oauth_account_email: 'ventas@acme.com',
}

function renderPanel(status: EmailSettingsStatus) {
  api.get.mockResolvedValue({ data: status })
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EmailIntegrationCard />
    </QueryClientProvider>,
  )
}

describe('EmailIntegrationCard', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.put.mockReset()
    api.post.mockReset()
  })

  it('ofrece conectar cada proveedor habilitado y manda al consentimiento', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign, origin: 'https://acme.example.com' })
    renderPanel(empty)
    api.post.mockResolvedValue({ data: { url: 'https://accounts.zoho.com/oauth/v2/auth?x' } })

    expect(await screen.findByText(/correo de la plataforma/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Conectar con Zoho/ }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.zoho.com/oauth/v2/auth?x'))
    expect(api.post).toHaveBeenCalledWith('/api/settings/email/connect', {
      provider: 'zoho', return_origin: 'https://acme.example.com',
    })
    vi.unstubAllGlobals()
  })

  it('es una tarjeta de Integraciones con ancla #correo y su estado', async () => {
    const { unmount } = renderPanel(empty)
    const card = await screen.findByRole('region', { name: /Correo de envío/ })
    expect(card).toHaveAttribute('id', 'correo')
    expect(await screen.findByText('Usa el de la plataforma')).toBeInTheDocument()
    unmount()

    renderPanel(smtp)
    expect(await screen.findByText('Conectado')).toBeInTheDocument()
  })

  it('solo muestra los proveedores que la plataforma habilitó', async () => {
    renderPanel({ ...empty, oauth_available: ['google'] })

    expect(await screen.findByRole('button', { name: /Conectar con Google/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Conectar con Microsoft/ })).not.toBeInTheDocument()
  })

  it('con una cuenta conectada muestra desde dónde sale y permite desconectar', async () => {
    renderPanel(oauth)
    api.post.mockResolvedValue({ data: empty })

    expect(await screen.findByText('Conectado con Zoho')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Desconectar/ }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/settings/email/disconnect'))
  })

  it('el SMTP queda como alternativa y guarda sin tocar la contraseña (null)', async () => {
    renderPanel(smtp)
    api.put.mockResolvedValue({ data: smtp })

    expect(await screen.findByText('Se envía desde ventas@acme.com.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(api.put).toHaveBeenCalled())
    expect(api.put.mock.calls[0]).toEqual(['/api/settings/email', {
      host: 'smtp.hostinger.com', port: 465, security: 'ssl', username: 'ventas@acme.com',
      password: null, from_address: 'ventas@acme.com', from_name: 'Acme',
    }])
  })

  it('la prueba avisa a quién se envió', async () => {
    renderPanel(oauth)
    api.post.mockResolvedValue({ data: { recipient: 'admin@acme.com', source: 'tenant' } })

    await userEvent.click(await screen.findByRole('button', { name: 'Enviar prueba' }))

    expect(await screen.findByText(/Enviado a admin@acme.com/)).toBeInTheDocument()
  })
})

describe('readEmailConnectReturn', () => {
  it('traduce el resultado del callback', () => {
    expect(readEmailConnectReturn('?settings=email&email=connected&provider=microsoft')).toEqual({
      ok: true, message: 'Correo conectado con Microsoft',
    })
    expect(readEmailConnectReturn('?settings=email&email=error&provider=zoho&reason=no_mailbox')?.ok).toBe(false)
    expect(readEmailConnectReturn('?settings=calendar&google=connected')).toBeNull()
  })
})
