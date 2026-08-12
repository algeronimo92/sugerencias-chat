import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TagsManagementPanel } from './TagsManagementPanel'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('../hooks/useLeadMeta', () => ({
  useTags: () => ({
    data: [
      { id: 1, name: 'VIP', color: '#16a34a', is_active: true, created_by_name: 'Lucía Ramos', created_at: '2026-08-10T12:00:00Z' },
      { id: 2, name: 'Campaña antigua', color: '#64748b', is_active: false },
    ],
    isLoading: false,
    error: null,
  }),
  useCreateTag: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateTag: () => ({ mutate: mocks.update, isPending: false, variables: undefined }),
}))

describe('TagsManagementPanel', () => {
  beforeEach(() => {
    mocks.create.mockReset()
    mocks.update.mockReset()
  })

  it('crea etiquetas desde el catálogo administrativo', async () => {
    const user = userEvent.setup()
    render(<TagsManagementPanel />)

    await user.type(screen.getByPlaceholderText('Nombre de la nueva etiqueta'), 'Paciente frecuente')
    await user.click(screen.getByRole('button', { name: 'Crear etiqueta' }))

    expect(mocks.create).toHaveBeenCalledWith(
      { name: 'Paciente frecuente', color: '#16a34a' },
      expect.any(Object),
    )
  })

  it('muestra quién creó la etiqueta', () => {
    render(<TagsManagementPanel />)

    expect(screen.getByText(/Creada por Lucía Ramos/)).toBeInTheDocument()
  })

  it('edita y desactiva una etiqueta sin borrarla', async () => {
    const user = userEvent.setup()
    render(<TagsManagementPanel />)

    const nameInput = screen.getByLabelText('Nombre de VIP')
    await user.clear(nameInput)
    await user.type(nameInput, 'Cliente premium')
    await user.click(screen.getByRole('button', { name: 'Guardar VIP' }))

    expect(mocks.update).toHaveBeenCalledWith(
      { id: 1, name: 'Cliente premium', color: '#16a34a' },
      expect.any(Object),
    )

    await user.click(screen.getByRole('button', { name: 'Activa' }))
    expect(mocks.update).toHaveBeenCalledWith(
      { id: 1, is_active: false },
      expect.any(Object),
    )
  })

  it('permite reactivar etiquetas antiguas', async () => {
    const user = userEvent.setup()
    render(<TagsManagementPanel />)

    await user.click(screen.getByRole('button', { name: 'Inactiva' }))
    expect(mocks.update).toHaveBeenCalledWith(
      { id: 2, is_active: true },
      expect.any(Object),
    )
  })
})
