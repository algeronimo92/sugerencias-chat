import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LeadAppointmentPanel } from './LeadAppointmentPanel'

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock('../../../shared/auth', () => ({ useMe: () => ({ data: { role: 'vendedor', name: 'Marta' } }) }))
vi.mock('../../platform/public/useUsers', () => ({ useSellers: () => ({ data: [{ id: 1, name: 'Luis' }, { id: 2, name: 'Marta' }], isLoading: false }) }))
vi.mock('../../catalogs/public/useCustomFields', () => ({
  useCustomFields: (entity: string) => ({
    data: [{ id: entity === 'lead' ? 1 : 2, entity_type: entity, key: 'dni', label: 'DNI', field_type: 'text', required: false, options: [], position: 0, is_active: true }],
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('../../catalogs/public/useLeadServices', () => ({
  useLeadServices: () => ({ data: [{ id: 7, name: 'Limpieza' }], isLoading: false }),
  useCreateLeadService: () => ({ isPending: false, mutate: vi.fn() }),
}))
vi.mock('../queries', () => ({ useCreateAppointment: () => ({ isPending: false, mutate: mocks.mutate }) }))

const LEAD = {
  id: '6f1c2e3a-0b4d-4c5e-8f9a-1b2c3d4e5f60', name: 'Ana', phone: '51987654321',
  servicio_interes: 'Limpieza', vendedor: 'Luis', customFields: { dni: '40404040' },
}

async function fillSchedule(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(screen.getByLabelText(/^Fecha/), { target: { value: '2026-11-12' } })
  await user.click(screen.getByLabelText(/^Hora/))
  await user.click(screen.getByRole('option', { name: '10:00' }))
}

describe('LeadAppointmentPanel', () => {
  afterEach(() => {
    localStorage.clear()
    mocks.mutate.mockReset()
  })

  it('prellena desde el lead y pide confirmar antes de guardar', async () => {
    const user = userEvent.setup()
    render(<LeadAppointmentPanel lead={LEAD} leadReady onClose={vi.fn()} />)

    expect(screen.getByLabelText(/^Nombre completo/)).toHaveValue('Ana')
    expect(screen.getByLabelText(/^Teléfono/)).toHaveAttribute('readonly')
    expect(screen.getByLabelText(/^DNI/)).toHaveValue('40404040')
    expect(screen.getAllByText('Del lead').length).toBeGreaterThanOrEqual(4)

    await fillSchedule(user)
    const save = screen.getByRole('button', { name: 'Guardar cita' })
    expect(save).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /Confirmo que los datos/ }))
    await user.click(save)

    expect(mocks.mutate).toHaveBeenCalledOnce()
    const [input] = mocks.mutate.mock.calls[0]
    expect(input).toMatchObject({
      leadId: LEAD.id, leadUpdates: null, nombreCompleto: 'Ana', telefono: '51987654321',
      tratamiento: 'Limpieza', vendedor: 'Luis', fecha: '2026-11-12', hora: '10:00',
      customFields: { dni: '40404040' },
    })
  })

  it('guarda el borrador solo y permite volver a los datos del lead', async () => {
    const user = userEvent.setup()
    const draftKey = `nueva-cita-lead-draft:${LEAD.id}`
    const { unmount } = render(<LeadAppointmentPanel lead={LEAD} leadReady onClose={vi.fn()} />)

    // Abrir el panel con lo del lead no deja borrador: nadie escribió nada.
    expect(screen.queryByText('Borrador guardado')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar borrador' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^Notas/), { target: { value: 'Viene con su hija' } })
    await waitFor(() => expect(screen.getByText('Borrador guardado')).toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem(draftKey) ?? '{}').form.detalle).toBe('Viene con su hija')

    // Al volver a abrirlo, sigue donde lo dejó.
    unmount()
    render(<LeadAppointmentPanel lead={LEAD} leadReady onClose={vi.fn()} />)
    expect(screen.getByLabelText(/^Notas/)).toHaveValue('Viene con su hija')

    await user.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(screen.getByLabelText(/^Notas/)).toHaveValue('')
    expect(screen.getByLabelText(/^Nombre completo/)).toHaveValue('Ana')
    expect(localStorage.getItem(draftKey)).toBeNull()
  })

  it('no pierde lo escrito si se cierra antes de que se guarde', () => {
    const draftKey = `nueva-cita-lead-draft:${LEAD.id}`
    const { unmount } = render(<LeadAppointmentPanel lead={LEAD} leadReady onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/^Notas/), { target: { value: 'Llamar antes' } })
    unmount()

    expect(JSON.parse(localStorage.getItem(draftKey) ?? '{}').form.detalle).toBe('Llamar antes')
  })

  it('ofrece llevar al lead lo que el vendedor corrigió', async () => {
    const user = userEvent.setup()
    render(<LeadAppointmentPanel lead={LEAD} leadReady onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/^Nombre completo/), { target: { value: 'Ana Pérez' } })
    fireEvent.change(screen.getByLabelText(/^DNI/), { target: { value: '12345678' } })
    await fillSchedule(user)
    await user.click(screen.getByRole('checkbox', { name: /Confirmo que los datos/ }))
    await user.click(screen.getByRole('button', { name: 'Guardar cita' }))

    expect(mocks.mutate).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Actualizar el lead' })).toBeInTheDocument()
    // Por defecto van todas; el vendedor desmarca el DNI.
    await user.click(screen.getByRole('checkbox', { name: /DNI/ }))
    await user.click(screen.getByRole('button', { name: 'Guardar cita' }))

    const [input] = mocks.mutate.mock.calls[0]
    expect(input.leadUpdates).toEqual({ nombre: 'Ana Pérez', custom_fields: {} })
    expect(input.customFields).toEqual({ dni: '12345678' })
  })
})
