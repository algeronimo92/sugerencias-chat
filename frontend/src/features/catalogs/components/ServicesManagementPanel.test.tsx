import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ServicesManagementPanel } from './ServicesManagementPanel'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  createPackage: vi.fn(),
  updatePackage: vi.fn(),
}))

vi.mock('../hooks/useLeadServices', () => ({
  useLeadServices: () => ({
    data: [
      {
        id: 1, name: 'Botox', is_active: true, created_by_name: 'Lucía Ramos', created_at: '2026-08-10T12:00:00Z',
        packages: [{ id: 10, service_id: 1, name: '1 sesión', sessions: 1, price: '150.00', position: 0, is_active: true }],
      },
      { id: 2, name: 'Tratamiento anterior', is_active: false, packages: [] },
    ],
    isLoading: false,
    error: null,
  }),
  useCreateLeadService: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateLeadService: () => ({ mutate: mocks.update, isPending: false, variables: undefined }),
  useCreateServicePackage: () => ({ mutate: mocks.createPackage, isPending: false }),
  useUpdateServicePackage: () => ({ mutate: mocks.updatePackage, isPending: false, variables: undefined }),
}))

describe('ServicesManagementPanel', () => {
  beforeEach(() => {
    mocks.create.mockReset()
    mocks.update.mockReset()
    mocks.createPackage.mockReset()
    mocks.updatePackage.mockReset()
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

  it('guarda solo la descripción que cambió para el asistente IA', async () => {
    const user = userEvent.setup()
    render(<ServicesManagementPanel />)

    await user.type(screen.getByLabelText('Descripción de Botox'), 'Toxina botulínica para líneas de expresión')
    await user.click(screen.getByRole('button', { name: 'Guardar Botox' }))

    expect(mocks.update).toHaveBeenCalledWith(
      { id: 1, description: 'Toxina botulínica para líneas de expresión' },
      expect.any(Object),
    )
  })

  it('muestra los paquetes del servicio y avisa cuando no tiene ninguno', () => {
    render(<ServicesManagementPanel />)

    expect(screen.getByLabelText('Precio del paquete 1 sesión de Botox')).toHaveValue(150)
    expect(screen.getByText(/Sin paquetes: el asistente IA no cotiza/)).toBeInTheDocument()
  })

  it('añade un paquete al servicio', async () => {
    const user = userEvent.setup()
    render(<ServicesManagementPanel />)

    await user.click(screen.getByRole('button', { name: 'Añadir paquete a Botox' }))
    await user.type(screen.getByLabelText('Nombre del nuevo paquete de Botox'), 'Pack x3')
    const sessions = screen.getByLabelText('Sesiones del nuevo paquete de Botox')
    await user.clear(sessions)
    await user.type(sessions, '3')
    await user.type(screen.getByLabelText('Precio del nuevo paquete de Botox'), '400')
    await user.click(screen.getByRole('button', { name: 'Guardar nuevo paquete de Botox' }))

    expect(mocks.createPackage).toHaveBeenCalledWith(
      { serviceId: 1, name: 'Pack x3', sessions: 3, price: '400' },
      expect.any(Object),
    )
  })

  it('no manda un paquete sin precio', async () => {
    const user = userEvent.setup()
    render(<ServicesManagementPanel />)

    await user.click(screen.getByRole('button', { name: 'Añadir paquete a Botox' }))
    await user.type(screen.getByLabelText('Nombre del nuevo paquete de Botox'), 'Pack x3')
    await user.click(screen.getByRole('button', { name: 'Guardar nuevo paquete de Botox' }))

    expect(mocks.createPackage).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('El precio debe ser un número mayor o igual a cero')
  })

  it('edita el precio de un paquete y lo desactiva sin perderlo', async () => {
    const user = userEvent.setup()
    render(<ServicesManagementPanel />)

    const price = screen.getByLabelText('Precio del paquete 1 sesión de Botox')
    await user.clear(price)
    await user.type(price, '180')
    await user.click(screen.getByRole('button', { name: 'Guardar paquete 1 sesión de Botox' }))

    expect(mocks.updatePackage).toHaveBeenCalledWith(
      { serviceId: 1, id: 10, price: '180' },
      expect.any(Object),
    )

    await user.click(screen.getByRole('button', { name: 'Desactivar paquete 1 sesión de Botox' }))
    expect(mocks.updatePackage).toHaveBeenCalledWith(
      { serviceId: 1, id: 10, is_active: false },
      expect.any(Object),
    )
  })
})
