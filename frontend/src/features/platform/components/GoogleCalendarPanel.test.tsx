import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../../shared/http/errors'
import { readGoogleCalendarReturn } from '../public/googleCalendarReturn'
import { GoogleCalendarPanel } from './GoogleCalendarPanel'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }))

vi.mock('../../../shared/http/client', () => ({ default: api }))

const disconnected = {
  oauth_available: true, connected: false, account_email: null, calendar_id: null,
  enabled: false, business_timezone: 'America/Lima',
}
const connected = {
  ...disconnected, connected: true, account_email: 'dueno@gmail.com', calendar_id: 'dueno@gmail.com', enabled: true,
}
const calendars = [
  { id: 'dueno@gmail.com', summary: 'Dueño', primary: true },
  { id: 'agenda@group.calendar.google.com', summary: 'Agenda', primary: false },
]

function respond({ status, calendarsError }: { status: typeof disconnected; calendarsError?: unknown }) {
  api.get.mockImplementation((url: string) => {
    if (url === '/api/settings/google-calendar/status') return Promise.resolve({ data: status })
    if (url === '/api/settings/google-calendar/calendars') {
      return calendarsError ? Promise.reject(calendarsError) : Promise.resolve({ data: calendars })
    }
    if (url === '/api/settings/timezones') {
      return Promise.resolve({ data: [{ id: 'America/Lima', label: 'GMT-5 Lima', offset_minutes: -300 }] })
    }
    return Promise.resolve({ data: [] })
  })
}

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GoogleCalendarPanel />
    </QueryClientProvider>,
  )
}

describe('GoogleCalendarPanel', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.put.mockReset()
  })

  it('avisa cuando la plataforma todavía no tiene cliente de Google', async () => {
    respond({ status: { ...disconnected, oauth_available: false } })
    renderPanel()

    expect(await screen.findByText(/todavía no habilitó la conexión con Google/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Conectar con Google' })).not.toBeInTheDocument()
  })

  it('pide la URL de consentimiento con el origen del CRM y navega a Google', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: 'https://crm.test', assign })
    respond({ status: disconnected })
    api.post.mockResolvedValue({ data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' } })
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Conectar con Google' }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'))
    expect(api.post).toHaveBeenCalledWith('/api/settings/google-calendar/authorize', { return_origin: 'https://crm.test' })
    vi.unstubAllGlobals()
  })

  it('muestra la cuenta conectada y permite desconectar', async () => {
    const user = userEvent.setup()
    respond({ status: connected })
    api.post.mockResolvedValue({ data: disconnected })
    renderPanel()

    expect(await screen.findByText('dueno@gmail.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Desconectar' }))

    expect(api.post).toHaveBeenCalledWith('/api/settings/google-calendar/disconnect')
    expect(await screen.findByRole('button', { name: 'Conectar con Google' })).toBeInTheDocument()
  })

  it('pide reconectar cuando Google ya no acepta el token', async () => {
    respond({
      status: connected,
      calendarsError: new ApiError({ status: 409, code: 'google_reconnect', detail: 'expiró' }),
    })
    renderPanel()

    expect(await screen.findByText(/Google ya no acepta esta conexión/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reconectar' })).toBeInTheDocument()
  })
})

describe('readGoogleCalendarReturn', () => {
  it('ignora las URLs que no vienen del callback', () => {
    expect(readGoogleCalendarReturn('?foo=1')).toBeNull()
  })

  it('traduce el resultado del callback', () => {
    expect(readGoogleCalendarReturn('?settings=calendar&google=connected')).toEqual({ ok: true, message: 'Google Calendar conectado' })
    expect(readGoogleCalendarReturn('?settings=calendar&google=error&reason=denied')?.message).toMatch(/canceló/)
    expect(readGoogleCalendarReturn('?settings=calendar&google=error&reason=otra')?.ok).toBe(false)
  })
})
