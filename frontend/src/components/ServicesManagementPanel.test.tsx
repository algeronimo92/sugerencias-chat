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
      { id: 1, name: 'Botox', is_active: true, price: '150.00', created_by_name: 'Lucía Ramos', created_at: '2026-08-10T12:00:00Z' },
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

    await user.type(screen.getByRole('textbox', { name: 'Nombre del nuevo servicio' }), 'Limpieza profunda')
    await user.click(screen.getByRole('button', { name: 'Crear servicio' }))

    expect(mocks.create).toHaveBeenCalledWith('Limpieza profunda', expect.any(Object))
  })

  it('muestra quién creó el servicio', () => {
    render(<ServicesManagementPanel />)

    expect(screen.getByText(/Creado por Lucía Ramos/)).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: 'Desactivar Botox' }))
    expect(mocks.update).toHaveBeenCalledWith(
      { id: 1, is_active: false },
      expect.any(Object),
    )
  })

  it('reactiva servicios antiguos', async () => {
    const user = userEvent.setup()
    render(<ServicesManagementPanel />)

    await user.click(screen.getByRole('button', { name: 'Activar Tratamiento anterior' }))
    expect(mocks.update).toHaveBeenCalledWith(
      { id: 2, is_active: true },
      expect.any(Object),
    )
  })

  it('guarda solo el precio y la descripción que cambiaron para el asistente IA', async () => {
    const user = userEvent.setup()
    render(<ServicesManagementPanel />)

    const price = screen.getByLabelText('Precio de Botox')
    expect(price).toHaveValue(150)
    await user.clear(price)
    await user.type(price, '180')
    await user.type(screen.getByLabelText('Descripción de Botox'), 'Toxina botulínica para líneas de expresión')
    await user.click(screen.getByRole('button', { name: 'Guardar Botox' }))

    expect(mocks.update).toHaveBeenCalledWith(
      { id: 1, price: '180', description: 'Toxina botulínica para líneas de expresión' },
      expect.any(Object),
    )
  })
})
