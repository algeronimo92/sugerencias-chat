import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ServicesManagementPanel } from './ServicesManagementPanel'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('../hooks/useLeadServices', () => ({
  useLeadServices: () => ({
    data: [
      { id: 1, name: 'Botox', is_active: true },
      { id: 2, name: 'Tratamiento anterior', is_active: false },
    ],
    isLoading: false,
    error: null,
  }),
  useCreateLeadService: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateLeadService: () => ({ mutate: mocks.update, isPending: false, variables: undefined }),
}))

describe('ServicesManagementPanel', () => {
  beforeEach(() => {
    mocks.create.mockReset()
    mocks.update.mockReset()
  })

  it('crea servicios desde el catálogo', async () => {
    const user = userEvent.setup()
    render(<ServicesManagementPanel />)

    await user.type(screen.getByPlaceholderText('Nombre del nuevo servicio'), 'Limpieza profunda')
    await user.click(screen.getByRole('button', { name: 'Crear servicio' }))

    expect(mocks.create).toHaveBeenCalledWith('Limpieza profunda', expect.any(Object))
  })

  it('edita y desactiva un servicio sin perderlo', async () => {
    const user = userEvent.setup()
    render(<ServicesManagementPanel />)

    const input = screen.getByLabelText('Nombre de Botox')
    await user.clear(input)
    await user.type(input, 'Botox premium')
    await user.click(screen.getByRole('button', { name: 'Guardar Botox' }))

    expect(mocks.update).toHaveBeenCalledWith(
      { id: 1, name: 'Botox premium' },
      expect.any(Object),
    )

    await user.click(screen.getByRole('button', { name: 'Activo' }))
    expect(mocks.update).toHaveBeenCalledWith(
      { id: 1, is_active: false },
      expect.any(Object),
    )
  })

  it('reactiva servicios antiguos', async () => {
    const user = userEvent.setup()
    render(<ServicesManagementPanel />)

    await user.click(screen.getByRole('button', { name: 'Inactivo' }))
    expect(mocks.update).toHaveBeenCalledWith(
      { id: 2, is_active: true },
      expect.any(Object),
    )
  })
})
