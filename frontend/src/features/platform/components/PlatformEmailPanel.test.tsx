import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PlatformEmailPanel } from './PlatformEmailPanel'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))

vi.mock('../../../shared/http/client', () => ({ default: api }))

const fromEnvironment = {
  source: 'environment',
  host: '',
  port: 587,
  security: 'starttls',
  username: '',
  password_configured: false,
  from_address: '',
  from_name: '',
  environment_host: 'smtp.env.com',
  environment_from_address: 'env@cliniventas.com',
}

const fromPanel = {
  ...fromEnvironment,
  source: 'platform',
  host: 'smtp.hostinger.com',
  port: 465,
  security: 'ssl',
  username: 'no-reply@cliniventas.com',
  password_configured: true,
  from_address: 'no-reply@cliniventas.com',
  from_name: 'CliniVentas',
}

function renderPanel() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PlatformEmailPanel />
    </QueryClientProvider>,
  )
}

describe('PlatformEmailPanel', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.put.mockReset()
    api.post.mockReset()
    api.delete.mockReset()
  })

  it('dice que hoy se usa el .env y guarda el SMTP de la plataforma', async () => {
    const user = userEvent.setup()
    api.get.mockResolvedValue({ data: fromEnvironment })
    api.put.mockResolvedValue({ data: fromPanel })
    renderPanel()

    expect(await screen.findByText('Desde entorno (.env)')).toBeInTheDocument()
    expect(screen.getByText(/smtp\.env\.com/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Servidor SMTP'), 'smtp.hostinger.com')
    await user.clear(screen.getByLabelText('Puerto'))
    await user.type(screen.getByLabelText('Puerto'), '465')
    await user.type(screen.getByLabelText('Correo remitente'), 'no-reply@cliniventas.com')
    await user.type(screen.getByLabelText('Contraseña'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Guardar correo' }))

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/platform/email', {
        host: 'smtp.hostinger.com',
        port: 465,
        security: 'starttls',
        username: '',
        password: 'secret',
        from_address: 'no-reply@cliniventas.com',
        from_name: '',
      }),
    )
    expect(await screen.findByText('Configurado aquí')).toBeInTheDocument()
    expect(screen.getByLabelText('Contraseña')).toHaveValue('')
  })

  it('sin cambiar la contraseña no la reenvía', async () => {
    const user = userEvent.setup()
    api.get.mockResolvedValue({ data: fromPanel })
    api.put.mockResolvedValue({ data: fromPanel })
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Guardar correo' }))

    await waitFor(() => expect(api.put).toHaveBeenCalled())
    expect(api.put.mock.calls[0][1]).toMatchObject({ password: null, host: 'smtp.hostinger.com', security: 'ssl' })
  })

  it('pide confirmación antes de borrar y vuelve al .env', async () => {
    const user = userEvent.setup()
    api.get.mockResolvedValue({ data: fromPanel })
    api.delete.mockResolvedValue({ data: fromEnvironment })
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Borrar' }))
    expect(screen.getByRole('alertdialog', { name: '¿Borrar el correo de la plataforma?' })).toBeInTheDocument()
    expect(api.delete).not.toHaveBeenCalled()
    await user.click(screen.getAllByRole('button', { name: 'Borrar' }).at(-1)!)

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api/platform/email'))
    expect(await screen.findByText('Desde entorno (.env)')).toBeInTheDocument()
  })
})
