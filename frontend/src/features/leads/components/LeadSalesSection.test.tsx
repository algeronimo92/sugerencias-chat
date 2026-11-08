import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LeadSalesSection } from './LeadSalesSection'
import type { Chat } from '../types'

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  remove: vi.fn(),
  sales: [] as unknown[],
}))

vi.mock('../hooks/useLeadSales', () => ({
  useLeadSales: () => ({ data: mocks.sales, isLoading: false }),
  useRecordLeadSale: () => ({ mutate: mocks.record, isPending: false }),
  useDeleteLeadSale: () => ({ mutate: mocks.remove, isPending: false }),
}))
vi.mock('./SaleDialog', () => ({
  SaleDialog: ({ onConfirm }: { onConfirm: (sale: unknown) => void }) => (
    <button type="button" onClick={() => onConfirm({ service_id: 3, package_id: 31, amount: null, notes: null })}>confirmar-venta</button>
  ),
}))

const chat = { chat_id: 'lead-1', name: 'Ana', servicio_interes: 'Hollywood Peel - Rostro' } as unknown as Chat

describe('LeadSalesSection', () => {
  beforeEach(() => {
    mocks.record.mockReset()
    mocks.remove.mockReset()
    mocks.sales = []
  })

  it('muestra las compras con su total y el precio de lista cuando hubo descuento', () => {
    mocks.sales = [
      { id: 1, lead_id: 'lead-1', service_name: 'Hollywood Peel - Rostro', package_name: 'x3', sessions: 3, list_price: '400.00', amount: '380.00', notes: 'Promo', sold_by_name: 'Lucía', sold_at: '2026-11-07T15:00:00Z', created_at: '2026-11-07T15:00:00Z' },
      { id: 2, lead_id: 'lead-1', service_name: 'Botox', package_name: 'Individual', sessions: 1, list_price: '500.00', amount: '500.00', notes: null, sold_by_name: null, sold_at: '2026-10-01T15:00:00Z', created_at: '2026-10-01T15:00:00Z' },
    ]
    render(<LeadSalesSection chat={chat} />)

    expect(screen.getByText(/total 880/)).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Compras del lead' })
    expect(list).toHaveTextContent('x3')
    expect(list).toHaveTextContent('Lucía')
    expect(list).toHaveTextContent('Promo')
    expect(screen.getByTitle('Precio de lista: 400')).toBeInTheDocument()
  })

  it('registra una compra desde la ficha', async () => {
    const user = userEvent.setup()
    render(<LeadSalesSection chat={chat} />)

    expect(screen.getByText('Todavía no compró nada.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Registrar compra' }))
    await user.click(screen.getByRole('button', { name: 'confirmar-venta' }))

    expect(mocks.record).toHaveBeenCalledWith({ service_id: 3, package_id: 31, amount: null, notes: null }, expect.any(Object))
  })

  it('pide confirmación antes de eliminar una compra', async () => {
    mocks.sales = [
      { id: 1, lead_id: 'lead-1', service_name: 'Botox', package_name: 'Individual', sessions: 1, list_price: '500.00', amount: '500.00', notes: null, sold_by_name: null, sold_at: '2026-10-01T15:00:00Z', created_at: '2026-10-01T15:00:00Z' },
    ]
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm')
    render(<LeadSalesSection chat={chat} />)

    confirm.mockReturnValueOnce(false)
    await user.click(screen.getByRole('button', { name: 'Eliminar compra Individual' }))
    expect(mocks.remove).not.toHaveBeenCalled()

    confirm.mockReturnValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Eliminar compra Individual' }))
    expect(mocks.remove).toHaveBeenCalledWith(1, expect.any(Object))
    confirm.mockRestore()
  })
})
