import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '../../../shared/queryClient'
import type { AppointmentDetail } from '../types'
import { AppointmentChangePage } from './AppointmentChangePage'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))

vi.mock('../../../shared/http/client', () => ({ default: api }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ana: AppointmentDetail = {
  id: 41, created_by_user_id: 7, created_by_name: 'Rosa', lead_id: 'lead-1', lead_owner_name: 'Rosa',
  nombre_completo: 'Ana Pérez Torres', dni: '45678912', telefono: '51987654321', tratamiento: 'HIFU 12D',
  detalle: '', fecha: '2026-11-19', hora: '16:00', vendedor: 'Rosa Vendedora', adelanto: 350, duration_minutes: 60,
  custom_fields: {}, comprobante_filename: null, test_mode: false, status: 'created', n8n_status: null, message: null,
  event_link: null, calendar_event_id: 'evt-1', calendar_sync_status: 'synced', calendar_sync_error: null,
  created_at: '2026-11-19T15:06:20Z', dismissed_at: null, dismissed_by_name: null, dismissed_reason: null, notices: [],
  calendar_change: {
    summary: 'BOTOX FULL FACE (x 850 soles) - Ana Pérez Torres - Rosa Vendedora',
    starts_at: '2026-11-27T21:00:00Z', detected_at: '2026-11-27T18:00:00Z', suggested_treatment: 'BOTOX FULL FACE',
  },
}

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/citas/41/cambio']}>
        <Routes>
          <Route path="/citas/:appointmentId/cambio" element={<AppointmentChangePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AppointmentChangePage', () => {
  beforeEach(() => {
    queryClient.clear()
    api.get.mockReset()
    api.post.mockReset()
  })

  it('muestra los dos lados y confirma con el servicio leído del calendario', async () => {
    api.get.mockResolvedValue({ data: ana })
    api.post.mockResolvedValue({ data: { ...ana, tratamiento: 'BOTOX FULL FACE', calendar_change: null } })
    renderPage()

    expect(await screen.findByText('HIFU 12D')).toBeInTheDocument()
    expect(screen.getByText(ana.calendar_change!.summary)).toBeInTheDocument()
    const input = screen.getByLabelText('Servicio de la cita')
    expect(input).toHaveValue('BOTOX FULL FACE')

    await userEvent.clear(input)
    await userEvent.type(input, 'Botox full face')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cambio' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/appointments/41/calendar-change/confirm', { tratamiento: 'Botox full face' },
    ))
  })

  it('una cita sin cambio pendiente lo dice y no ofrece confirmar', async () => {
    api.get.mockResolvedValue({ data: { ...ana, calendar_change: null } })
    renderPage()

    expect(await screen.findByText('Esta cita no tiene cambios por confirmar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar cambio' })).not.toBeInTheDocument()
  })
})
