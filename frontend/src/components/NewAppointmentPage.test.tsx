import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NewAppointmentPage } from './NewAppointmentPage'

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock('../hooks/useAuth', () => ({ useMe: () => ({ data: { role: 'admin' } }) }))
vi.mock('../hooks/useUsers', () => ({ useSellers: () => ({ data: [{ id: 1, name: 'Asesor' }] }) }))
vi.mock('../hooks/useCustomFields', () => ({ useCustomFields: () => ({
  data: [{ id: 1, entity_type: 'appointment', key: 'autorizado', label: 'Autorizado', field_type: 'boolean', required: true, options: [], position: 0, is_active: true }],
  isLoading: false,
  isError: false,
}) }))
vi.mock('../hooks/useAppointments', () => ({
  useCreateAppointment: () => ({ isPending: false, mutate: mocks.mutate }),
}))
vi.mock('./AppointmentHistoryList', () => ({ AppointmentHistoryList: () => null }))
vi.mock('./AppointmentCalendar', () => ({ AppointmentCalendar: () => null }))

// La cámara real ya tiene sus propios tests; acá solo importa que la página la
// abra y se quede con la foto que devuelve.
vi.mock('./CameraCaptureDialog', () => ({
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

    await user.type(screen.getByLabelText('Nombre completo *'), 'Ana')
    await user.type(screen.getByLabelText('Teléfono *'), '987654321')
    await user.type(screen.getByLabelText('Servicio o motivo *'), 'Consulta')
    await user.click(screen.getByLabelText('Responsable *'))
    await user.click(screen.getByRole('option', { name: 'Asesor' }))
    await user.type(screen.getByLabelText('Fecha *'), '2026-10-01')
    await user.click(screen.getByLabelText('Hora *'))
    await user.click(screen.getByRole('option', { name: '10:00' }))
    await user.click(screen.getByRole('button', { name: 'Guardar cita' }))

    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({
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
