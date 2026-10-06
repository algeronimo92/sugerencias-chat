/**
 * Caracterización del armazón de la aplicación (fase 0 del refactor).
 *
 * Monta la app completa contra un backend falso y fija lo que decide el
 * armazón: qué se muestra según la sesión, quién entra a cada ruta, qué pasa
 * cuando cualquier request devuelve 401 y cómo se resuelven las rutas que no
 * son del CRM (panel de plataforma y enlaces de cuenta). La fase 4 migra el
 * router y la fase 6 los permisos: este test tiene que seguir pasando igual.
 */

import { AxiosError } from 'axios'
import { configure, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import client from '../shared/http/client'
import { queryClient } from '../shared/queryClient'
import { installFakeApi } from '../test/fakeApi'
import { installFakeSocket } from '../test/fakeSocket'
import App from './App'

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, () => {}], updateServiceWorker: () => {} }),
}))

const api = installFakeApi()
installFakeSocket()

// Estos tests montan la app entera y cargan sus pantallas de forma diferida:
// con la suite corriendo en paralelo, el segundo que espera `findBy` por
// defecto se queda corto sin que haya nada roto.
configure({ asyncUtilTimeout: 5_000 })

const ADMIN = { id: 1, email: 'admin@clinica.test', name: 'Admin', role: 'admin' }
const SELLER = { id: 2, email: 'vendedor@clinica.test', name: 'Vendedor', role: 'vendedor' }

function at(path: string) {
  window.history.replaceState({}, '', path)
}

function crmDefaults() {
  api.current
    .on('get', '/api/chats', { data: { items: [], has_more: false } })
    .on('get', '/api/chats/unread-count', { data: { count: 0 } })
    .on('get', '/api/notifications', { data: { items: [], has_more: false, unread_count: 0 } })
    .on('get', '/api/auth/pin/status', { data: { available: false, locked_seconds: 0 } })
}

beforeEach(() => {
  queryClient.clear()
  crmDefaults()
})

describe('sesión', () => {
  it('sin backend muestra el aviso de conexión y reintenta', async () => {
    let attempts = 0
    api.current.on('get', '/api/auth/me', () => {
      attempts += 1
      if (attempts === 1) throw new AxiosError('Network Error', AxiosError.ERR_NETWORK)
      return { data: ADMIN }
    })
    at('/')
    render(<App />)

    expect(await screen.findByText('No se pudo establecer conexión con el servidor.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar conexión' }))
    expect(await screen.findByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument()
  })

  it('sin sesión muestra el login y al entrar abre el CRM', async () => {
    api.current.on('get', '/api/auth/me', { status: 401 })
    api.current.on('post', '/api/auth/login', { data: SELLER })
    at('/')
    render(<App />)

    await userEvent.type(await screen.findByLabelText('Correo electrónico'), 'vendedor@clinica.test')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'secreta-123')
    await userEvent.click(screen.getByRole('button', { name: /Ingresar a/ }))

    expect(await screen.findByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument()
    expect(api.current.calls('post', '/api/auth/login').map(request => request.body)).toEqual([{
      email: 'vendedor@clinica.test', password: 'secreta-123', remember_device: true, mfa_code: null,
    }])
  })

  it('un login rechazado muestra el motivo del servidor', async () => {
    api.current.on('get', '/api/auth/me', { status: 401 })
    api.current.on('post', '/api/auth/login', { status: 401, data: { detail: 'Credenciales inválidas' } })
    at('/')
    render(<App />)

    await userEvent.type(await screen.findByLabelText('Correo electrónico'), 'vendedor@clinica.test')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala')
    await userEvent.click(screen.getByRole('button', { name: /Ingresar a/ }))

    expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument()
  })

  it('un 401 en cualquier request vuelve al login', async () => {
    api.current.on('get', '/api/auth/me', { data: SELLER })
    at('/')
    render(<App />)
    await screen.findByRole('button', { name: 'Cerrar sesión' })

    api.current.on('get', '/api/auth/me', { status: 401 })
    api.current.on('get', '/api/cualquier-cosa', { status: 401 })
    await client.get('/api/cualquier-cosa').catch(() => undefined)

    expect(await screen.findByLabelText('Correo electrónico')).toBeInTheDocument()
  })

  it('cerrar sesión avisa al servidor y vuelve al login', async () => {
    api.current.on('get', '/api/auth/me', { data: SELLER })
    api.current.on('post', '/api/auth/logout', () => {
      // El servidor cierra la sesión: desde ahí nada la reconoce.
      api.current.on('get', /.*/, { status: 401 })
      return { status: 204 }
    })
    at('/')
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }))

    expect(await screen.findByLabelText('Correo electrónico')).toBeInTheDocument()
    expect(api.current.calls('post', '/api/auth/logout')).toHaveLength(1)
  })

  it('si cerrar sesión falla igual vuelve al login', async () => {
    api.current.on('get', '/api/auth/me', { data: SELLER })
    api.current.on('post', '/api/auth/logout', () => {
      throw new AxiosError('Network Error', AxiosError.ERR_NETWORK)
    })
    at('/')
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }))

    expect(await screen.findByLabelText('Correo electrónico')).toBeInTheDocument()
  })
})

describe('autorización de rutas', () => {
  it.each(['/templates', '/media-library', '/automations', '/catalogs', '/ai-assistant'])(
    'un vendedor que entra a %s vuelve a la bandeja',
    async path => {
      api.current.on('get', '/api/auth/me', { data: SELLER })
      at(path)
      render(<App />)

      await screen.findByRole('button', { name: 'Cerrar sesión' })
      await waitFor(() => expect(window.location.pathname).toBe('/'))
    },
  )

  it('un admin entra a las rutas de administración', async () => {
    api.current.on('get', '/api/auth/me', { data: ADMIN })
    at('/templates')
    render(<App />)

    await screen.findByRole('button', { name: 'Cerrar sesión' })
    await waitFor(() => expect(api.current.calls('get', '/api/templates').length).toBeGreaterThan(0))
    expect(window.location.pathname).toBe('/templates')
  })

  it('la configuración del negocio solo la ve un admin', async () => {
    api.current.on('get', '/api/auth/me', { data: SELLER })
    at('/')
    render(<App />)

    await screen.findByRole('button', { name: 'Cerrar sesión' })
    expect(screen.queryByRole('button', { name: 'Configuración' })).not.toBeInTheDocument()
  })

  it('una ruta desconocida vuelve a la bandeja', async () => {
    api.current.on('get', '/api/auth/me', { data: SELLER })
    at('/no-existe')
    render(<App />)

    await screen.findByRole('button', { name: 'Cerrar sesión' })
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })
})

describe('rutas fuera del CRM', () => {
  it('/platform abre el panel de plataforma con su propia sesión', async () => {
    api.current.on('get', '/api/platform/auth/me', { status: 401 })
    at('/platform')
    render(<App />)

    expect(await screen.findByText('Ingresa al panel')).toBeInTheDocument()
    expect(api.current.calls('get', '/api/auth/me')).toEqual([])
  })

  it('un enlace de recuperación abre la pantalla de nueva contraseña sin pedir sesión', async () => {
    api.current.on('get', '/api/auth/action-token/tok-1', {
      data: { purpose: 'password_reset', email: 'ana@clinica.test', name: 'Ana' },
    })
    at('/reset-password?token=tok-1')
    render(<App />)

    expect(await screen.findByText('Crea una nueva contraseña')).toBeInTheDocument()
    expect(api.current.calls('get', '/api/auth/me')).toEqual([])
  })

  it('una invitación saluda a la persona invitada', async () => {
    api.current.on('get', '/api/auth/action-token/tok-2', {
      data: { purpose: 'invitation', email: 'luis@clinica.test', name: 'Luis' },
    })
    at('/accept-invitation?token=tok-2')
    render(<App />)

    expect(await screen.findByText('Hola, Luis')).toBeInTheDocument()
  })
})
