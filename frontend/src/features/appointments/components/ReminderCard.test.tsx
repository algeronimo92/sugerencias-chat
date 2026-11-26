import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReminderSettings } from '../types'
import { ReminderCard } from './ReminderCard'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))

vi.mock('../../../shared/http/client', () => ({ default: api }))

const settings: ReminderSettings = {
  include_manual_events: false,
  hours: null,
  reminders: [
    { offset_minutes: 1440, enabled: true, template_id: 7, parameters: ['{nombre_completo}', '{fecha_larga} a las {hora_12h}'] },
    { offset_minutes: 300, enabled: false, template_id: null, parameters: [] },
    { offset_minutes: 60, enabled: false, template_id: null, parameters: [] },
  ],
  fields: [
    { key: 'nombre_completo', label: 'Contacto', group: 'cita' },
    { key: 'fecha_larga', label: 'Fecha larga', group: 'cita' },
    { key: 'hora_12h', label: 'Hora (01:00 Pm)', group: 'cita' },
  ],
  templates: [{ id: 7, name: 'recordatorio_cita', content: 'Hola {{1}}, te esperamos el {{2}}.', variable_count: 2, suggested_parameters: [] }],
  preview: { label: 'AYME', values: { nombre_completo: 'AYME', fecha_larga: 'JUEVES 12 de Noviembre', hora_12h: '01:00 Pm' } },
  calendar_ready: true,
  sender_ready: false,
  recent: [{
    id: 1, offset_minutes: 60, starts_at: '2026-12-10T20:00:00+00:00', appointment_id: null, event_summary: 'Limpieza',
    recipient_name: '', status: 'skipped', reason: 'El evento no trae un teléfono', delivery_status: null, created_at: '2026-12-10T19:00:00+00:00',
  }],
}

function renderCard(data: ReminderSettings = settings) {
  api.get.mockResolvedValue({ data })
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReminderCard />
    </QueryClientProvider>,
  )
}

describe('ReminderCard', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.put.mockReset()
  })

  it('avisa qué falta para que salgan y muestra el historial', async () => {
    renderCard()
    expect(await screen.findByText(/Elige el número de avisos/)).toBeInTheDocument()
    expect(screen.getByText('Falta configurar')).toBeInTheDocument()
    expect(screen.getByText('El evento no trae un teléfono')).toBeInTheDocument()
    expect(screen.getByText('No enviado')).toBeInTheDocument()
  })

  it('muestra cómo le llega al paciente y guarda la anticipación editada', async () => {
    api.put.mockImplementation(async (_url, body) => ({ data: { ...settings, ...body } }))
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Recordatorios (3)' }))
    expect(screen.getByText('Hola AYME, te esperamos el JUEVES 12 de Noviembre a las 01:00 Pm.')).toBeInTheDocument()

    const [, , lastAmount] = screen.getAllByLabelText('Anticipación')
    await userEvent.clear(lastAmount)
    await userEvent.type(lastAmount, '2')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar recordatorios' }))

    await waitFor(() => expect(api.put).toHaveBeenCalled())
    const [url, body] = api.put.mock.calls[0]
    expect(url).toBe('/api/appointments/reminders')
    expect(body.reminders.map((item: { offset_minutes: number }) => item.offset_minutes)).toEqual([1440, 300, 120])
    expect(body.reminders[0]).toEqual({
      offset_minutes: 1440, enabled: true, template_id: 7, parameters: ['{nombre_completo}', '{fecha_larga} a las {hora_12h}'],
    })
  })

  it('no deja guardar dos recordatorios con la misma anticipación', async () => {
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Recordatorios (3)' }))
    const [, five] = screen.getAllByLabelText('Anticipación')
    await userEvent.clear(five)
    await userEvent.type(five, '1')
    // 1 hora: igual que el tercero.
    expect(screen.getAllByText('Ya hay un recordatorio con esa anticipación')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Guardar recordatorios' })).toBeDisabled()
  })

  it('limita los recordatorios a las citas de un horario', async () => {
    api.put.mockImplementation(async (_url, body) => ({ data: { ...settings, ...body } }))
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Recordatorios (3)' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Recordar solo las citas de un horario/ }))
    expect(screen.getByLabelText('Horario de las citas: desde')).toHaveValue('09:00')
    expect(screen.getByLabelText('Horario de las citas: hasta')).toHaveValue('19:00')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar recordatorios' }))
    await waitFor(() => expect(api.put).toHaveBeenCalled())
    expect(api.put.mock.calls[0][1].hours).toEqual({ start: '09:00', end: '19:00' })
  })

  it('ofrece cuándo y cuánto falta como datos del recordatorio', async () => {
    renderCard({
      ...settings,
      fields: [{ key: 'cuando', label: 'Cuándo (hoy, mañana o el martes 6 de octubre)', group: 'recordatorio' }, ...settings.fields],
      reminders: [{ offset_minutes: 1440, enabled: true, template_id: 7, parameters: ['{nombre_completo}', '{cuando}'] }],
      preview: { label: 'AYME', values: { ...settings.preview!.values, cuando: 'mañana' } },
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Recordatorios (1)' }))
    expect(screen.getByText('Hola AYME, te esperamos el mañana.')).toBeInTheDocument()
  })
})
