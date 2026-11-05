import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Organization } from '../types'
import { describeStarterPackResult } from '../starterPack'
import { StarterPackAction } from './StarterPackAction'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('../../../shared/http/client', () => ({ default: api }))

const organizacion = { id: 'org-1', name: 'Clínica Norte' } as Organization

describe('StarterPackAction', () => {
  beforeEach(() => api.post.mockReset())

  it('pide confirmación y muestra lo que agregó', async () => {
    api.post.mockResolvedValue({
      data: { tags: 6, categories: 3, templates: 7, automations: 3, needs_admin: 0 },
    })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <StarterPackAction organizacion={organizacion} />
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Paquete inicial' }))
    expect(api.post).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Aplicar paquete' }))

    expect(api.post).toHaveBeenCalledWith('/api/platform/organizations/org-1/starter-pack')
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Se agregaron 6 etiquetas, 7 plantillas, 3 automatizaciones.',
    )
  })

  it('explica cuando no había nada que agregar o falta el admin', () => {
    expect(describeStarterPackResult({ tags: 0, categories: 0, templates: 0, automations: 0, needs_admin: 0 }))
      .toBe('El negocio ya tenía todo el paquete.')
    expect(describeStarterPackResult({ tags: 2, categories: 0, templates: 0, automations: 0, needs_admin: 1 }))
      .toMatch(/pendientes hasta que el negocio tenga un admin activo/)
  })
})
