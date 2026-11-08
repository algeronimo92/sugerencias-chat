import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ServicesManagementPanel } from './ServicesManagementPanel'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  createPackage: vi.fn(),
  updatePackage: vi.fn(),
  runSync: vi.fn(),
  erpStatus: vi.fn(() => ({ configured: false }) as Record<string, unknown>),
}))

vi.mock('../hooks/useLeadServices', () => ({
  useLeadServices: () => ({
    data: [
      {
        id: 1, name: 'Botox', is_active: true, created_by_name: 'Lucía Ramos', created_at: '2026-08-10T12:00:00Z',
        packages: [{ id: 10, service_id: 1, name: '1 sesión', sessions: 1, price: '150.00', position: 0, is_active: true }],
      },
      { id: 2, name: 'Tratamiento anterior', is_active: false, packages: [] },
      {
        id: 3, name: 'Hollywood Peel - Rostro', is_active: true, external_id: 'svc-1',
        packages: [
          { id: 30, service_id: 3, name: 'Individual', sessions: 1, price: '180.00', position: 0, is_active: true, external_id: 'svc-1' },
          { id: 31, service_id: 3, name: 'x3', sessions: 3, price: '400.00', position: 1, is_active: false, external_id: 'pk-3' },
        ],
      },
    ],
    isLoading: false,
    error: null,
  }),
  useCreateLeadService: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateLeadService: () => ({ mutate: mocks.update, isPending: false, variables: undefined }),
  useDeleteLeadService: () => ({ mutate: mocks.remove, isPending: false }),
  useCreateServicePackage: () => ({ mutate: mocks.createPackage, isPending: false }),
  useUpdateServicePackage: () => ({ mutate: mocks.updatePackage, isPending: false, variables: undefined }),
  useErpSyncStatus: () => ({ data: mocks.erpStatus(), isLoading: false }),
  useRunErpSync: () => ({ mutate: mocks.runSync, isPending: false }),
}))

describe('ServicesManagementPanel', () => {
  beforeEach(() => {
    mocks.create.mockReset()
    mocks.update.mockReset()
    mocks.remove.mockReset()
    mocks.createPackage.mockReset()
    mocks.updatePackage.mockReset()
    mocks.runSync.mockReset()
    mocks.erpStatus.mockReset()
    mocks.erpStatus.mockReturnValue({ configured: false })
  })

  it('crea servicios desde el catálogo', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><ServicesManagementPanel /></MemoryRouter>)

    await user.type(screen.getByRole('textbox', { name: 'Nombre del nuevo servicio' }), 'Limpieza profunda')
    await user.click(screen.getByRole('button', { name: 'Crear servicio' }))

    expect(mocks.create).toHaveBeenCalledWith('Limpieza profunda', expect.any(Object))
  })

  it('muestra quién creó el servicio', () => {
    render(<MemoryRouter><ServicesManagementPanel /></MemoryRouter>)

    expect(screen.getByText(/Creado por Lucía Ramos/)).toBeInTheDocument()
  })

  it('edita y desactiva un servicio sin perderlo', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><ServicesManagementPanel /></MemoryRouter>)

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
    render(<MemoryRouter><ServicesManagementPanel /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: 'Activar Tratamiento anterior' }))
    expect(mocks.update).toHaveBeenCalledWith(
      { id: 2, is_active: true },
      expect.any(Object),
    )
  })

  it('no tiene campos de texto para la IA: eso va en las fichas del servicio', () => {
    render(<MemoryRouter><ServicesManagementPanel /></MemoryRouter>)

    expect(screen.queryByLabelText('Descripción de Botox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Notas de precio de Botox')).not.toBeInTheDocument()
  })

  it('muestra los paquetes del servicio y avisa cuando no tiene ninguno', () => {
    render(<MemoryRouter><ServicesManagementPanel /></MemoryRouter>)

    expect(screen.getByLabelText('Precio del paquete 1 sesión de Botox')).toHaveValue(150)
    expect(screen.getByText(/Sin paquetes: el asistente IA no cotiza/)).toBeInTheDocument()
  })

  it('añade un paquete al servicio', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><ServicesManagementPanel /></MemoryRouter>)

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
    render(<MemoryRouter><ServicesManagementPanel /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: 'Añadir paquete a Botox' }))
    await user.type(screen.getByLabelText('Nombre del nuevo paquete de Botox'), 'Pack x3')
    await user.click(screen.getByRole('button', { name: 'Guardar nuevo paquete de Botox' }))

    expect(mocks.createPackage).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('El precio debe ser un número mayor o igual a cero')
  })

  it('edita el precio de un paquete y lo desactiva sin perderlo', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><ServicesManagementPanel /></MemoryRouter>)

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

  it('explica cómo conectar el ERP cuando no hay URL', () => {
    render(<MemoryRouter><ServicesManagementPanel /></MemoryRouter>)

    expect(screen.getByText('Sin ERP conectado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sincronizar ahora con el ERP' })).not.toBeInTheDocument()
  })

  it('muestra el estado del ERP y permite sincronizar ahora', async () => {
    mocks.erpStatus.mockReturnValue({
      configured: true,
      url: 'https://erp.example.test/api/public/catalog',
      synced_at: '2026-11-07T15:00:00Z',
      last_error: 'El ERP respondió 500 al pedir el catálogo',
      last_summary: {
        services_total: 61, services_created: 2, services_updated: 0, services_deactivated: 1,
        packages_created: 3, packages_updated: 0, packages_deactivated: 0, conflicts: ['Botox'],
      },
    })
    const user = userEvent.setup()
    render(<MemoryRouter><ServicesManagementPanel /></MemoryRouter>)

    expect(screen.getByText(/erp\.example\.test/)).toBeInTheDocument()
    expect(screen.getByText(/61 servicios en el ERP · 2 nuevos · 1 desactivados · 3 paquetes con cambios/)).toBeInTheDocument()
    expect(screen.getByText(/chocan con un servicio cargado a mano.*Botox/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('El ERP respondió 500')

    await user.click(screen.getByRole('button', { name: 'Sincronizar ahora con el ERP' }))
    expect(mocks.runSync).toHaveBeenCalledTimes(1)
  })

  it('deja en solo lectura lo que administra el ERP', () => {
    render(<MemoryRouter><ServicesManagementPanel /></MemoryRouter>)

    // El nombre del ERP se muestra como texto con candado, no como un campo deshabilitado.
    expect(screen.queryByLabelText('Nombre de Hollywood Peel - Rostro')).not.toBeInTheDocument()
    expect(screen.getByText('(nombre administrado por el ERP)')).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre de Botox')).not.toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Desactivar Hollywood Peel - Rostro' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Añadir paquete a Hollywood Peel - Rostro' })).not.toBeInTheDocument()
    const packages = screen.getByRole('list', { name: 'Paquetes de Hollywood Peel - Rostro' })
    expect(packages).toHaveTextContent('Individual · 1 sesión')
    expect(packages).toHaveTextContent('180.00')
    expect(packages).toHaveTextContent('x3 · 3 sesiones')
    expect(screen.getByText('Sincronizado desde el ERP')).toBeInTheDocument()
    // Nada que guardar en la fila: el botón no aparece.
    expect(screen.queryByRole('button', { name: 'Guardar Hollywood Peel - Rostro' })).not.toBeInTheDocument()
  })

  it('cada servicio dice de dónde viene y se puede filtrar por origen', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><ServicesManagementPanel /></MemoryRouter>)

    expect(screen.getAllByText('ERP · solo lectura')).toHaveLength(1)
    expect(screen.getAllByText('Manual · editable')).toHaveLength(2)

    const filter = screen.getByRole('group', { name: 'Filtrar por origen' })
    await user.click(within(filter).getByRole('button', { name: /Del ERP/ }))
    expect(screen.queryByLabelText('Nombre de Botox')).not.toBeInTheDocument()
    expect(screen.getByText('Hollywood Peel - Rostro')).toBeInTheDocument()

    await user.click(within(filter).getByRole('button', { name: /Manuales/ }))
    expect(screen.getByLabelText('Nombre de Botox')).toBeInTheDocument()
    expect(screen.queryByText('Hollywood Peel - Rostro')).not.toBeInTheDocument()
  })

  it('elimina un servicio manual tras confirmar; los del ERP no tienen esa opción', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><ServicesManagementPanel /></MemoryRouter>)

    expect(screen.queryByRole('button', { name: 'Eliminar Hollywood Peel - Rostro' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Eliminar Botox' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/no se puede deshacer/)).toBeInTheDocument()
    expect(mocks.remove).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Eliminar' }))
    expect(mocks.remove).toHaveBeenCalledWith(1, expect.any(Object))
  })
})
