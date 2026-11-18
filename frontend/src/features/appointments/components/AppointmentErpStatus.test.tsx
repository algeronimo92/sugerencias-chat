import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppointmentListItem } from '../types'
import { AppointmentErpStatus } from './AppointmentErpStatus'

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock('../queries', () => ({
  useSyncAppointmentErp: () => ({ mutate: mocks.mutate, isPending: false, isError: false, variables: undefined, error: null }),
}))

const base = {
  id: 41, test_mode: false, dismissed_at: null, package_name: 'x3',
  erp_sync_status: 'not_configured', erp_sync_error: null, erp_link: null,
} as unknown as AppointmentListItem

describe('AppointmentErpStatus', () => {
  afterEach(() => mocks.mutate.mockReset())

  it('dice que la cita está en la agenda del ERP y la abre allá', () => {
    render(<AppointmentErpStatus item={{ ...base, erp_sync_status: 'synced', erp_link: 'https://erp.example/appointments/abc' }} erpActive />)

    expect(screen.getByText('En la agenda del ERP')).toBeInTheDocument()
    expect(screen.getByText('Paquete: x3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver en el ERP/ })).toHaveAttribute('href', 'https://erp.example/appointments/abc')
    expect(screen.queryByRole('button', { name: /Enviar al ERP/ })).toBeNull()
  })

  it('explica por qué no llegó y deja reenviarla', async () => {
    const user = userEvent.setup()
    render(<AppointmentErpStatus item={{ ...base, erp_sync_status: 'error', erp_sync_error: 'El ERP no respondió a tiempo' }} erpActive />)

    expect(screen.getByText('No llegó al ERP')).toBeInTheDocument()
    expect(screen.getByText('El ERP no respondió a tiempo')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Enviar al ERP/ }))
    expect(mocks.mutate).toHaveBeenCalledWith(41)
  })

  it('ofrece enviar una cita anterior a la integración', () => {
    render(<AppointmentErpStatus item={base} erpActive />)

    expect(screen.getByText('Sin enviar al ERP')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enviar al ERP/ })).toBeInTheDocument()
  })

  it('no ofrece enviar una cita de prueba ni una desestimada', () => {
    const { rerender, container } = render(<AppointmentErpStatus item={{ ...base, test_mode: true }} erpActive />)
    expect(container).toBeEmptyDOMElement()

    rerender(<AppointmentErpStatus item={{ ...base, erp_sync_status: 'error', erp_sync_error: 'caído', dismissed_at: '2026-11-14T15:00:00Z' }} erpActive />)
    expect(screen.getByText('caído')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Enviar al ERP/ })).toBeNull()
  })

  it('no muestra nada si el negocio no envía citas al ERP', () => {
    const { container } = render(<AppointmentErpStatus item={base} erpActive={false} />)
    expect(container).toBeEmptyDOMElement()
  })
})
