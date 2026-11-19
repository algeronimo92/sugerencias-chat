import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CallsSettings } from './CallsSettings'

const mocks = vi.hoisted(() => ({
  readiness: { data: null as Record<string, unknown> | null, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() },
  users: [] as Record<string, unknown>[],
  update: vi.fn(),
  save: vi.fn(),
  calling: { enabled: false, hours_enabled: false, hours: [], agents: 1 } as Record<string, unknown>,
}))

vi.mock('../hooks/useWhatsapp', () => ({
  useCallingReadiness: () => mocks.readiness,
  useCallingSettings: () => ({ data: mocks.calling, isLoading: false, isError: false, refetch: vi.fn() }),
  useSaveCallingSettings: () => ({ mutate: mocks.save, isPending: false }),
}))
vi.mock('../hooks/useUsers', () => ({
  useUsers: () => ({ data: mocks.users, isLoading: false, isError: false }),
  useUpdateUser: () => ({ mutate: mocks.update, isPending: false }),
}))

const user = (id: number, overrides: Record<string, unknown> = {}) => ({
  id, email: `u${id}@example.com`, name: `Persona ${id}`, role: 'vendedor', is_active: true,
  invitation_pending: false, phone: null, can_handle_calls: false, ...overrides,
})

const readiness = (overrides: Record<string, unknown> = {}) => ({
  state: 'ready', on_business_app: false, messaging_limit: 'TIER_2K', messaging_limit_ok: true, ...overrides,
})

describe('CallsSettings', () => {
  beforeEach(() => {
    mocks.readiness = { data: readiness(), isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }
    mocks.users = []
    mocks.update.mockReset()
    mocks.save.mockReset()
    mocks.calling = { enabled: false, hours_enabled: false, hours: [], agents: 1 }
  })

  it('con el número en la app de WhatsApp Business avisa que hay que mudarlo y qué cambia', () => {
    mocks.readiness.data = readiness({ state: 'requires_migration', on_business_app: true })
    render(<CallsSettings />)

    expect(screen.getByText('Para atender llamadas desde el CRM hay que mudar el número')).toBeInTheDocument()
    expect(screen.getByText(/se pierden los grupos/)).toBeInTheDocument()
    expect(screen.getByText(/no se puede deshacer/)).toBeInTheDocument()
    expect(screen.queryByText(/coexistencia/i)).not.toBeInTheDocument()
  })

  it('con el límite bajo dice cuánto tiene la cuenta', () => {
    mocks.readiness.data = readiness({ state: 'limit_too_low', messaging_limit: 'TIER_250', messaging_limit_ok: false })
    render(<CallsSettings />)

    expect(screen.getByText(/\(hoy: 250\)/)).toBeInTheDocument()
  })

  it('listo: muestra el límite y deja activar con el horario elegido', async () => {
    const userEvents = userEvent.setup()
    render(<CallsSettings />)

    await userEvents.click(screen.getByRole('button', { name: 'Sáb' }))
    await userEvents.click(screen.getByRole('button', { name: 'Activar llamadas' }))
    expect(mocks.save).toHaveBeenCalledWith(
      { enabled: true, hours: expect.arrayContaining([{ day: 'SATURDAY', open: '0900', close: '1900' }]) },
      expect.anything(),
    )
    expect(screen.getByText('Límite de mensajes de la cuenta: 2000 por día.')).toBeInTheDocument()
  })

  it('si Meta no responde ofrece reintentar en vez de mostrar un estado', async () => {
    const userEvents = userEvent.setup()
    mocks.readiness = { data: null, isLoading: false, isError: true, isFetching: false, refetch: vi.fn() }
    render(<CallsSettings />)

    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos consultar el estado en Meta.')
    await userEvents.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.readiness.refetch).toHaveBeenCalled()
  })

  it('cargando: lo dice, sin interruptores de activación', () => {
    mocks.readiness = { data: null, isLoading: true, isError: false, isFetching: true, refetch: vi.fn() }
    render(<CallsSettings />)

    expect(screen.getByText('Consultando a Meta…')).toBeInTheDocument()
  })

  it('lista quién puede atender, sin analistas ni desactivados, y cambia el permiso de una persona', async () => {
    const userEvents = userEvent.setup()
    mocks.users = [
      user(1, { name: 'Ana', can_handle_calls: true }),
      user(2, { name: 'Bea' }),
      user(3, { name: 'Caro', role: 'analista' }),
      user(4, { name: 'Dani', is_active: false }),
      user(5, { name: 'Eli', is_active: false, invitation_pending: true }),
    ]
    render(<CallsSettings />)

    expect(screen.getByText(/1 persona atiende/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Ana atiende llamadas' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('switch', { name: 'Caro atiende llamadas' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Dani atiende llamadas' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Eli atiende llamadas' })).toBeInTheDocument()

    await userEvents.click(screen.getByRole('switch', { name: 'Bea atiende llamadas' }))
    expect(mocks.update).toHaveBeenCalledWith({ id: 2, can_handle_calls: true }, expect.anything())
  })

  it('sin nadie que atienda no deja activar', () => {
    mocks.calling = { enabled: false, hours_enabled: false, hours: [], agents: 0 }
    render(<CallsSettings />)

    expect(screen.getByRole('button', { name: 'Activar llamadas' })).toBeDisabled()
    expect(screen.getByText(/sonarían en el vacío/)).toBeInTheDocument()
  })

  it('mientras haya que mudar el número no ofrece activar', () => {
    mocks.readiness.data = readiness({ state: 'requires_migration', on_business_app: true })
    render(<CallsSettings />)

    expect(screen.queryByRole('button', { name: 'Activar llamadas' })).not.toBeInTheDocument()
  })

  it('sin nadie elegido lo dice', () => {
    mocks.users = [user(1)]
    render(<CallsSettings />)

    expect(screen.getByText(/Nadie todavía/)).toBeInTheDocument()
  })
})
