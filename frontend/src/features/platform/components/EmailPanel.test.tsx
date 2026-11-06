import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EmailSettingsStatus } from '../types'
import { EmailPanel } from './EmailPanel'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))

vi.mock('../../../shared/http/client', () => ({ default: api }))

const empty: EmailSettingsStatus = {
  configured: false, platform_available: true, host: '', port: 587, security: 'starttls',
  username: '', password_configured: false, from_address: '', from_name: '',
}
const configured: EmailSettingsStatus = {
  ...empty, configured: true, host: 'smtp.gmail.com', username: 'ventas@acme.com',
  password_configured: true, from_address: 'ventas@acme.com', from_name: 'Acme',
}

function renderPanel(status: EmailSettingsStatus) {
  api.get.mockResolvedValue({ data: status })
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EmailPanel />
    </QueryClientProvider>,
  )
}

describe('EmailPanel', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.put.mockReset()
    api.post.mockReset()
  })

  it('un negocio sin correo propio ve que hoy envía la plataforma y carga Gmail con lo mínimo', async () => {
    renderPanel(empty)
    expect(await screen.findByText(/correo de la plataforma/)).toBeInTheDocument()
    api.put.mockResolvedValue({ data: configured })

    await userEvent.type(screen.getByLabelText('Correo remitente'), 'ventas@acme.com')
    await userEvent.type(screen.getByLabelText('Contraseña de aplicación'), 'app-pass')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(api.put).toHaveBeenCalled())
    expect(api.put.mock.calls[0]).toEqual(['/api/settings/email', {
      host: 'smtp.gmail.com', port: 587, security: 'starttls',
      // Sin usuario aparte, se autentica con el mismo correo remitente.
      username: 'ventas@acme.com', password: 'app-pass',
      from_address: 'ventas@acme.com', from_name: '',
    }])
    expect(await screen.findByText('Guardado')).toBeInTheDocument()
  })

  it('guardar sin tocar la contraseña la conserva (manda null, no vacío)', async () => {
    renderPanel(configured)
    expect(await screen.findByText('Se envía desde ventas@acme.com.')).toBeInTheDocument()
    api.put.mockResolvedValue({ data: configured })

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(api.put).toHaveBeenCalled())
    expect(api.put.mock.calls[0][1].password).toBeNull()
  })

  it('la prueba avisa a quién se envió', async () => {
    renderPanel(configured)
    api.post.mockResolvedValue({ data: { recipient: 'admin@acme.com', source: 'tenant' } })

    await userEvent.click(await screen.findByRole('button', { name: 'Enviar prueba' }))

    expect(await screen.findByText(/Enviado a admin@acme.com/)).toBeInTheDocument()
    expect(api.post).toHaveBeenCalledWith('/api/settings/email/test')
  })
})
