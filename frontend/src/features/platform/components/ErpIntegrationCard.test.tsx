import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ErpIntegrationCard } from './ErpIntegrationCard'

const mocks = vi.hoisted(() => ({
  settings: [] as { key: string; group: string; value: string | null; configured: boolean; secret: boolean; boolean: boolean; label: string; group_label: string }[],
  save: vi.fn(),
  test: vi.fn(),
  runSync: vi.fn(),
  status: { configured: false } as Record<string, unknown>,
}))

vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({ data: mocks.settings, isLoading: false }),
  useSaveSettings: () => ({ mutate: mocks.save, isPending: false }),
}))
vi.mock('../../catalogs/public/useErpSync', () => ({
  useErpSyncStatus: () => ({ data: mocks.status, isLoading: false }),
  useRunErpSync: () => ({ mutate: mocks.runSync, isPending: false }),
  useTestErpConnection: () => ({ mutate: mocks.test, isPending: false }),
  useInvalidateErpSync: () => vi.fn(),
}))
vi.mock('../../catalogs/public/ErpSyncCard', () => ({ ErpSyncCard: () => <div>estado-de-sincronizacion</div> }))

const urlSetting = (value: string) => ({ key: 'erp_catalog_url', group: 'erp', value, configured: Boolean(value), secret: false, boolean: false, label: 'URL', group_label: 'ERP' })

function renderCard() {
  return render(<MemoryRouter><ErpIntegrationCard /></MemoryRouter>)
}

describe('ErpIntegrationCard', () => {
  beforeEach(() => {
    mocks.save.mockReset()
    mocks.test.mockReset()
    mocks.runSync.mockReset()
    mocks.settings = [urlSetting('')]
    mocks.status = { configured: false }
  })

  it('no deja guardar una URL sin probarla, y tras una prueba correcta sí', async () => {
    const user = userEvent.setup()
    mocks.test.mockImplementation((_url: string, options: { onSuccess: (result: unknown) => void }) => options.onSuccess({
      ok: true, url: 'https://erp.example.test/api/public/catalog', error: null, services_total: 61, packages_total: 110,
      services_without_packages: ['Consulta'],
      sample: [{ name: 'Hollywood Peel - Rostro', packages: [{ label: 'Individual', sessions: 1, price: '180.00' }, { label: 'x3', sessions: 3, price: '400.00' }] }],
    }))
    renderCard()

    expect(screen.getByText('Sin configurar')).toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Guardar y conectar' })
    const test = screen.getByRole('button', { name: 'Probar conexión' })
    expect(save).toBeDisabled()
    expect(test).toBeDisabled()

    await user.type(screen.getByLabelText('URL pública del catálogo'), 'https://erp.example.test/api/public/catalog')
    expect(screen.getByText(/Prueba la URL antes de guardar/)).toBeInTheDocument()
    expect(save).toBeDisabled()
    await user.click(test)

    expect(mocks.test).toHaveBeenCalledWith('https://erp.example.test/api/public/catalog', expect.any(Object))
    const result = screen.getByRole('status')
    expect(result).toHaveTextContent('Conexión correcta · erp.example.test')
    expect(result).toHaveTextContent('61 servicios · 110 paquetes')
    expect(result).toHaveTextContent('Individual · 1 sesión · 180.00')
    expect(result).toHaveTextContent('1 servicio sin paquetes: Consulta')
    expect(result).toHaveTextContent(/pasan a solo lectura en Catálogos/)
    expect(save).toBeEnabled()

    await user.click(save)
    expect(mocks.save).toHaveBeenCalledWith({ erp_catalog_url: 'https://erp.example.test/api/public/catalog' }, expect.any(Object))
  })

  it('al editar la URL después de probar vuelve a bloquear Guardar', async () => {
    const user = userEvent.setup()
    mocks.test.mockImplementation((_url: string, options: { onSuccess: (result: unknown) => void }) => options.onSuccess({
      ok: true, url: 'https://erp.test/a', error: null, services_total: 1, packages_total: 1, services_without_packages: [], sample: [],
    }))
    renderCard()
    const input = screen.getByLabelText('URL pública del catálogo')
    await user.type(input, 'https://erp.test/a')
    await user.click(screen.getByRole('button', { name: 'Probar conexión' }))
    expect(screen.getByRole('button', { name: 'Guardar y conectar' })).toBeEnabled()

    await user.type(input, 'b')
    expect(screen.getByRole('button', { name: 'Guardar y conectar' })).toBeDisabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('explica el error de formato y no habilita Guardar', async () => {
    const user = userEvent.setup()
    mocks.test.mockImplementation((_url: string, options: { onSuccess: (result: unknown) => void }) => options.onSuccess({
      ok: false, url: 'https://erp.test/x', error: 'El catálogo del ERP no tiene el formato esperado (data: Field required)',
      services_total: 0, packages_total: 0, services_without_packages: [], sample: [],
    }))
    renderCard()
    await user.type(screen.getByLabelText('URL pública del catálogo'), 'https://erp.test/x')
    await user.click(screen.getByRole('button', { name: 'Probar conexión' }))

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo leer el catálogo')
    expect(screen.getByRole('alert')).toHaveTextContent('formato esperado')
    expect(screen.getByRole('button', { name: 'Guardar y conectar' })).toBeDisabled()
  })

  it('conectado: muestra el host, el estado de sincronización y permite desconectar con confirmación', async () => {
    const user = userEvent.setup()
    mocks.settings = [urlSetting('https://erp.example.test/api/public/catalog')]
    mocks.status = { configured: true, last_error: null }
    renderCard()

    expect(screen.getByText('Conectado · erp.example.test')).toBeInTheDocument()
    expect(screen.getByText('estado-de-sincronizacion')).toBeInTheDocument()
    expect(screen.getByLabelText('URL pública del catálogo')).toHaveValue('https://erp.example.test/api/public/catalog')

    await user.click(screen.getByRole('button', { name: 'Desconectar' }))
    // El diálogo de confirmación repite el verbo: es el último botón con ese nombre.
    await user.click(screen.getAllByRole('button', { name: 'Desconectar' }).at(-1)!)
    expect(mocks.save).toHaveBeenCalledWith({ erp_catalog_url: '' }, expect.any(Object))
  })

  it('marca con error cuando la última sincronización falló', () => {
    mocks.settings = [urlSetting('https://erp.example.test/c')]
    mocks.status = { configured: true, last_error: 'El ERP respondió 500' }
    renderCard()
    expect(screen.getByText('Con error')).toBeInTheDocument()
  })
})
