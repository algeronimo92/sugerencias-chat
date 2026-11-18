import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErpAppointmentsSection } from './ErpAppointmentsSection'

const mocks = vi.hoisted(() => ({
  config: { active: false, enabled: false, url: '', token_configured: false, catalog_connected: true },
  save: vi.fn(),
  test: vi.fn(),
  testData: undefined as { ok: boolean; error: string | null } | undefined,
}))

vi.mock('../queries', () => ({
  useErpAppointmentsConfig: () => ({ data: mocks.config, isLoading: false }),
  useSaveErpAppointmentsConfig: () => ({ mutate: mocks.save, isPending: false }),
  useTestErpAppointments: () => ({ mutate: mocks.test, isPending: false, isError: false, data: mocks.testData, error: null }),
}))

function fill(url: string, token: string) {
  fireEvent.change(screen.getByLabelText('Dirección del ERP'), { target: { value: url } })
  fireEvent.change(screen.getByLabelText('Token de la integración'), { target: { value: token } })
}

describe('ErpAppointmentsSection', () => {
  afterEach(() => {
    mocks.config = { active: false, enabled: false, url: '', token_configured: false, catalog_connected: true }
    mocks.testData = undefined
    mocks.save.mockReset()
    mocks.test.mockReset()
  })

  it('no deja encender el envío sin una prueba de conexión exitosa', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ErpAppointmentsSection />)

    await user.click(screen.getByRole('checkbox'))
    fill('https://erp.example', 'secreto')
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(screen.getByText('Prueba la conexión antes de guardar.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Probar conexión' }))
    expect(mocks.test).toHaveBeenCalledWith({ url: 'https://erp.example', token: 'secreto' })

    mocks.testData = { ok: true, error: null }
    rerender(<ErpAppointmentsSection />)
    expect(screen.getByText(/la dirección y el token son correctos/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(mocks.save).toHaveBeenCalledWith(
      { enabled: true, url: 'https://erp.example', token: 'secreto' }, expect.any(Object),
    )
  })

  it('muestra por qué falló la prueba y sigue sin dejar guardar', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ErpAppointmentsSection />)
    await user.click(screen.getByRole('checkbox'))
    fill('https://erp.example', 'malo')
    await user.click(screen.getByRole('button', { name: 'Probar conexión' }))

    mocks.testData = { ok: false, error: 'El ERP rechazó el token de la integración' }
    rerender(<ErpAppointmentsSection />)

    expect(screen.getByRole('alert')).toHaveTextContent('El ERP rechazó el token')
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  it('apagar el envío no exige probar nada y conserva el token', async () => {
    mocks.config = { active: true, enabled: true, url: 'https://erp.example', token_configured: true, catalog_connected: true }
    const user = userEvent.setup()
    render(<ErpAppointmentsSection />)

    expect(screen.getByLabelText('Dirección del ERP')).toHaveValue('https://erp.example')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(mocks.save).toHaveBeenCalledWith(
      { enabled: false, url: 'https://erp.example', token: null }, expect.any(Object),
    )
  })

  it('no ofrece probar sin dirección válida o sin token', () => {
    render(<ErpAppointmentsSection />)

    fill('erp.example', 'secreto')
    expect(screen.getByRole('button', { name: 'Probar conexión' })).toBeDisabled()
    fill('https://erp.example', '')
    expect(screen.getByRole('button', { name: 'Probar conexión' })).toBeDisabled()
  })
})
