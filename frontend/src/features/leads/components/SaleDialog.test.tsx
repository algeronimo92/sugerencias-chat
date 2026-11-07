import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SaleDialog } from './SaleDialog'

vi.mock('../../catalogs/public/useLeadServices', () => ({
  useLeadServices: () => ({
    isLoading: false,
    data: [
      {
        id: 3, name: 'Hollywood Peel - Rostro', is_active: true,
        packages: [
          { id: 30, service_id: 3, name: 'Individual', sessions: 1, price: '180.00', position: 0, is_active: true },
          { id: 31, service_id: 3, name: 'x3', sessions: 3, price: '400.00', position: 1, is_active: true },
          { id: 32, service_id: 3, name: 'x6', sessions: 6, price: '700.00', position: 2, is_active: false },
        ],
      },
      { id: 4, name: 'Consulta', is_active: true, packages: [] },
      { id: 5, name: 'Botox', is_active: true, packages: [{ id: 50, service_id: 5, name: 'Individual', sessions: 1, price: '500.00', position: 0, is_active: true }] },
    ],
  }),
}))

describe('SaleDialog', () => {
  it('preselecciona el servicio de interés, ofrece solo paquetes activos y prellena el precio de lista', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SaleDialog leadName="Ana" defaultServiceName="hollywood peel - rostro" stageName="Cliente activo" allowSkip onConfirm={onConfirm} onCancel={() => {}} />)

    expect(screen.getByRole('combobox', { name: 'Servicio' })).toHaveTextContent('Hollywood Peel - Rostro')
    await user.click(screen.getByRole('combobox', { name: 'Paquete' }))
    expect(screen.queryByRole('option', { name: /x6/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /x3 · 3 sesiones · 400.00/ }))
    expect(screen.getByLabelText('Monto cobrado')).toHaveValue(400)

    await user.clear(screen.getByLabelText('Monto cobrado'))
    await user.type(screen.getByLabelText('Monto cobrado'), '380')
    expect(screen.getByText('Lista: 400.00')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Notas'), 'Promo')
    await user.click(screen.getByRole('button', { name: 'Mover y registrar' }))

    expect(onConfirm).toHaveBeenCalledWith({ service_id: 3, package_id: 31, amount: '380', notes: 'Promo' })
  })

  it('no confirma sin paquete y permite mover sin registrar', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SaleDialog leadName="Ana" stageName="Cliente activo" allowSkip onConfirm={onConfirm} onCancel={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Mover y registrar' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Elige el servicio y el paquete')

    await user.click(screen.getByRole('button', { name: 'Mover sin registrar' }))
    expect(onConfirm).toHaveBeenCalledWith(null)
  })

  it('sin etapa solo registra y no ofrece saltear', () => {
    render(<SaleDialog leadName="Ana" onConfirm={() => {}} onCancel={() => {}} />)

    expect(screen.getByRole('button', { name: 'Registrar compra' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mover sin registrar' })).not.toBeInTheDocument()
  })
})
