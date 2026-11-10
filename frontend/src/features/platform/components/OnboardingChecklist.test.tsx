import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OnboardingStatus } from '../types'
import { OnboardingChecklist } from './OnboardingChecklist'
import { OnboardingReopenButton } from './OnboardingReopenButton'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('../../../shared/http/client', () => ({ default: api }))

const pending: OnboardingStatus = {
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
}

function renderChecklist(props: Partial<Parameters<typeof OnboardingChecklist>[0]> = {}) {
  const onOpenSettings = vi.fn()
  const onOpenIntegrations = vi.fn()
  const onNavigate = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OnboardingChecklist
        enabled
        pathname="/"
        onOpenSettings={onOpenSettings}
        onOpenIntegrations={onOpenIntegrations}
        onNavigate={onNavigate}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onOpenSettings, onNavigate, onOpenIntegrations }
}

describe('OnboardingChecklist', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
  })

  it('muestra el avance calculado por el backend', async () => {
    api.get.mockResolvedValue({ data: pending })
    renderChecklist()

    expect(await screen.findByText('1 de 4 listos')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    expect(api.get).toHaveBeenCalledWith('/api/onboarding')
  })

  it('lleva cada paso pendiente a su pantalla o pestaña', async () => {
    api.get.mockResolvedValue({ data: pending })
    const user = userEvent.setup()
    const { onOpenSettings, onNavigate, onOpenIntegrations } = renderChecklist()

    await user.click(await screen.findByRole('button', { name: /Primeros pasos/ }))

    // El paso hecho no ofrece acción.
    expect(screen.queryByRole('button', { name: 'Conectar: Conectar WhatsApp' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Invitar: Invitar al equipo' }))
    await user.click(screen.getByRole('button', { name: 'Conectar: Conectar Google Calendar' }))
    await user.click(screen.getByRole('button', { name: 'Cargar: Cargar servicios y precios' }))
    await user.click(screen.getByRole('button', { name: 'Revisar: Revisar plantillas' }))

    expect(onOpenSettings.mock.calls).toEqual([['usuarios']])
    expect(onOpenIntegrations.mock.calls).toEqual([['calendario']])
    expect(onNavigate.mock.calls).toEqual([['/catalogs'], ['/templates']])
    expect(screen.getByText('(opcional)')).toBeInTheDocument()
  })

  it('se oculta cuando todo lo obligatorio está hecho', async () => {
    api.get.mockResolvedValue({ data: { ...pending, completed: 4, all_done: true } })
    renderChecklist()

    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Primeros pasos' })).not.toBeInTheDocument()
  })

  it('descartarla la oculta para todo el negocio', async () => {
    api.get.mockResolvedValue({ data: pending })
    api.post.mockResolvedValue({ data: { ...pending, dismissed: true } })
    const user = userEvent.setup()
    renderChecklist()

    await user.click(await screen.findByRole('button', { name: 'Ocultar los primeros pasos' }))

    expect(api.post).toHaveBeenCalledWith('/api/onboarding/dismiss')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Primeros pasos' })).not.toBeInTheDocument())
  })

  it('después de ocultarla, el ícono de la barra la vuelve a mostrar', async () => {
    api.get.mockResolvedValue({ data: pending })
    api.post.mockImplementation(async (url: string) => ({
      data: { ...pending, dismissed: url === '/api/onboarding/dismiss' },
    }))
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OnboardingReopenButton enabled className="" />
        <OnboardingChecklist enabled pathname="/" onOpenSettings={vi.fn()} onNavigate={vi.fn()} onOpenIntegrations={vi.fn()} />
      </QueryClientProvider>,
    )

    // Con la tarjeta a la vista el ícono no hace falta.
    await screen.findByRole('region', { name: 'Primeros pasos' })
    expect(screen.queryByRole('button', { name: /Mostrar los primeros pasos/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ocultar los primeros pasos' }))
    await user.click(await screen.findByRole('button', { name: 'Mostrar los primeros pasos (1 de 4 listos)' }))

    expect(api.post).toHaveBeenLastCalledWith('/api/onboarding/restore')
    expect(await screen.findByRole('region', { name: 'Primeros pasos' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mostrar los primeros pasos/ })).not.toBeInTheDocument()
  })

  it('no consulta nada para quien no es admin', () => {
    renderChecklist({ enabled: false })

    expect(api.get).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Primeros pasos' })).not.toBeInTheDocument()
  })
})
