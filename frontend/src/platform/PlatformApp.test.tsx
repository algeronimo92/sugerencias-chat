import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PlatformApp } from './PlatformApp'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }))

vi.mock('../api/client', () => ({ default: api }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }) }))

const organizations = [
  { id: '1', name: 'DermicaPro', status: 'active', schema_name: 'tenant_1', storage_prefix: 'tenant-1', created_at: null, revision: 'abc', migration_status: 'ok', up_to_date: true, domains: [{ id: 'd1', hostname: 'dermicapro.localhost', is_primary: true }] },
  { id: '2', name: 'Clínica Piloto', status: 'active', schema_name: 'tenant_2', storage_prefix: 'tenant-2', created_at: null, revision: 'abc', migration_status: 'ok', up_to_date: true, domains: [{ id: 'd2', hostname: 'piloto.localhost', is_primary: true }] },
]

describe('PlatformApp', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.delete.mockReset()
    api.get.mockImplementation((url: string) => {
      if (url === '/api/platform/auth/me') return Promise.resolve({ data: { id: 'op', name: 'Gerson', email: 'op@example.com' } })
      return Promise.resolve({ data: { head: 'abc', items: organizations } })
    })
    api.post.mockResolvedValue({ data: {} })
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
})
