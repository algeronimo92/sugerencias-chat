import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarEventTemplateEditor } from './CalendarEventTemplateEditor'

const mutate = vi.fn()

vi.mock('../queries', () => ({
  useCalendarEventTemplate: () => ({
    isLoading: false,
    isError: false,
    data: {
      title_template: '{tratamiento}',
      description_template: 'Contacto: {nombre_completo}',
      default_title_template: '{tratamiento}',
      default_description_template: 'Contacto: {nombre_completo}',
      fields: [
        { key: 'tratamiento', label: 'Servicio', custom: false },
        { key: 'nombre_completo', label: 'Contacto', custom: false },
        { key: 'custom.sede', label: 'Sede', custom: true },
      ],
    },
  }),
  useSaveCalendarEventTemplate: () => ({
    mutate, reset: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null,
  }),
}))

describe('CalendarEventTemplateEditor', () => {
  beforeEach(() => mutate.mockClear())

  it('suma al título el campo tocado y guarda la plantilla armada', () => {
    render(<CalendarEventTemplateEditor />)
    const save = screen.getByRole('button', { name: 'Guardar formato' })
    expect(save).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Contacto' }))

    expect(screen.getByText('Consulta Ana Pérez')).toBeInTheDocument()
    fireEvent.click(save)
    expect(mutate).toHaveBeenCalledWith({
      title: '{tratamiento} {nombre_completo}',
      description: 'Contacto: {nombre_completo}',
    })
  })

  it('mueve una pieza con Alt + flecha y la quita con Supr', () => {
    render(<CalendarEventTemplateEditor />)
    fireEvent.click(screen.getByRole('button', { name: 'Sede' }))

    const sede = screen.getByLabelText('Campo Sede')
    fireEvent.keyDown(sede, { key: 'ArrowLeft', altKey: true })
    expect(screen.getByText('(Sede) Consulta')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByLabelText('Campo Sede'), { key: 'Delete' })
    expect(screen.queryByLabelText('Campo Sede')).not.toBeInTheDocument()
  })
})
