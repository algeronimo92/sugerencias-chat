import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NewAppointmentPage } from './NewAppointmentPage'

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }))

// El formulario muestra el símbolo de la moneda junto al adelanto.
vi.mock('../hooks/useBusinessCurrency', () => ({ useBusinessCurrency: () => 'PEN' }))
vi.mock('../../../shared/auth', () => ({ useMe: () => ({ data: { role: 'admin' } }) }))
vi.mock('../../platform/hooks/useUsers', () => ({ useSellers: () => ({ data: [{ id: 1, name: 'Asesor' }] }) }))
vi.mock('../../catalogs/public/useCustomFields', () => ({ useCustomFields: () => ({
  data: [{ id: 1, entity_type: 'appointment', key: 'autorizado', label: 'Autorizado', field_type: 'boolean', required: true, options: [], position: 0, is_active: true }],
  isLoading: false,
  isError: false,
}) }))
vi.mock('../../catalogs/public/useLeadServices', () => ({
  useLeadServices: () => ({ data: [{ id: 7, name: 'Consulta' }], isLoading: false }),
  useCreateLeadService: () => ({ isPending: false, mutate: vi.fn() }),
}))
vi.mock('../queries', () => ({
  useCreateAppointment: () => ({ isPending: false, mutate: mocks.mutate }),
}))
vi.mock('../../platform/public/useGoogleCalendar', () => ({ useGoogleCalendarStatus: () => ({ data: { connected: true } }) }))
vi.mock('./AppointmentHistoryList', () => ({ AppointmentHistoryList: () => null }))
vi.mock('./AppointmentCalendar', () => ({ AppointmentCalendar: () => null }))

// La cámara real ya tiene sus propios tests; acá solo importa que la página la
// abra y se quede con la foto que devuelve.
vi.mock('../../../shared/ui/CameraCaptureDialog', () => ({
  CameraCaptureDialog: ({ onCapture }: { onCapture: (file: File) => void }) => (
    <button
      type="button"
      onClick={() => onCapture(new File(['jpeg'], 'comprobante-20260919-120000.jpg', { type: 'image/jpeg' }))}
    >
      Disparar
    </button>
  ),
}))

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value })
}

describe('NewAppointmentPage: comprobante por cámara', () => {
  afterEach(() => {
    localStorage.clear()
    mocks.mutate.mockReset()
    vi.restoreAllMocks()
  })

  it('envía false para un campo Sí/No obligatorio de la cita', async () => {
    const user = userEvent.setup()
    render(<NewAppointmentPage />)

    fireEvent.change(screen.getByLabelText('Nombre completo *'), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByLabelText('Teléfono *'), { target: { value: '987654321' } })
    await user.type(screen.getByRole('combobox', { name: 'Tratamiento *' }), 'consul')
    await user.click(screen.getByRole('option', { name: 'Consulta' }))
    await user.click(screen.getByLabelText('Responsable *'))
    await user.click(screen.getByRole('option', { name: 'Asesor' }))
    fireEvent.change(screen.getByLabelText('Fecha de la cita *'), { target: { value: '2026-10-01' } })
    await user.click(screen.getByLabelText('Hora *'))
    await user.click(screen.getByRole('option', { name: '10:00' }))
    await user.click(screen.getByRole('button', { name: 'Separar cita' }))

    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({
      tratamiento: 'Consulta',
      customFields: { autorizado: false },
    }), expect.any(Object))
  })

  it('adjunta como comprobante la foto tomada con la cámara', async () => {
    const user = userEvent.setup()
    setMediaDevices({ getUserMedia: vi.fn(), enumerateDevices: vi.fn() })

    render(<NewAppointmentPage />)

    await user.click(screen.getByRole('button', { name: 'Tomar foto' }))
    await user.click(screen.getByRole('button', { name: 'Disparar' }))

    expect(screen.getByText('comprobante-20260919-120000.jpg')).toBeInTheDocument()
    // Tomada la foto, el diálogo se cierra y quedan los controles de adjunto.
    expect(screen.queryByRole('button', { name: 'Disparar' })).not.toBeInTheDocument()
  })

  it('cae en la cámara nativa del sistema si el navegador no expone getUserMedia', async () => {
    const user = userEvent.setup()
    setMediaDevices(undefined)
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})

    render(<NewAppointmentPage />)
    await user.click(screen.getByRole('button', { name: 'Tomar foto' }))

    expect(screen.queryByRole('button', { name: 'Disparar' })).not.toBeInTheDocument()
    const clicked = click.mock.contexts[0] as HTMLInputElement
    expect(clicked.getAttribute('capture')).toBe('environment')
  })
})

describe('NewAppointmentPage: validación por campo', () => {
  afterEach(() => {
    localStorage.clear()
    mocks.mutate.mockReset()
  })

  it('nombra lo que falta, marca cada campo y lleva el foco al primero', async () => {
    const user = userEvent.setup()
    render(<NewAppointmentPage />)

    await user.click(screen.getByRole('button', { name: 'Separar cita' }))

    expect(mocks.mutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Revisa estos datos: Tratamiento, Fecha, Hora, Responsable, Nombre y Teléfono.')
    const service = screen.getByRole('combobox', { name: 'Tratamiento *' })
    expect(service).toHaveAttribute('aria-invalid', 'true')
    expect(service).toHaveAccessibleDescription(/Elige el tratamiento que separó\./)
    await new Promise(resolve => requestAnimationFrame(resolve))
    expect(service).toHaveFocus()

    // Corregir el campo borra su error en el momento.
    fireEvent.change(screen.getByLabelText('Nombre completo *'), { target: { value: 'Ana' } })
    expect(screen.queryByText('Escribe el nombre del cliente.')).toBeNull()
  })

  it('ofrece atajos de fecha y arranca las horas en la mañana', async () => {
    const user = userEvent.setup()
    render(<NewAppointmentPage />)

    await user.click(screen.getByRole('button', { name: 'Mañana' }))
    expect(screen.getByRole('button', { name: 'Mañana' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Fecha de la cita *')).not.toHaveValue('')

    await user.click(screen.getByLabelText('Hora *'))
    const hours = screen.getAllByRole('option').map(option => option.textContent)
    expect(hours.slice(0, 2)).toEqual(['Elige la hora', '07:00'])
    expect(hours).toContain('06:30')
  })
})
