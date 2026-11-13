import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LeadFormDialog } from './LeadFormDialog'
import { buildStageCatalog, DEFAULT_LEAD_STAGES } from '../domain/leadStageMeta'

const mocks = vi.hoisted(() => ({ createService: vi.fn() }))

vi.mock('../../auth/queries', () => ({
  useMe: () => ({ data: { id: 7, role: 'vendedor', name: 'Gerson' } }),
}))
vi.mock('../../platform/hooks/useUsers', () => ({ useSellers: () => ({ data: [] }) }))
vi.mock('../queries', () => ({
  useDuplicateLead: () => ({ data: null, isFetching: false }),
  usePhoneConfig: () => ({ data: { default_country_code: '51' } }),
}))
vi.mock('../../catalogs/public/useLeadServices', () => ({
  useLeadServices: () => ({
    data: [
      { id: 1, name: 'Botox' },
      { id: 2, name: 'Limpieza facial' },
    ],
    isLoading: false,
  }),
  useCreateLeadService: () => ({ mutate: mocks.createService, isPending: false }),
}))
vi.mock('../../catalogs/public/useCustomFields', () => ({
  useCustomFields: () => ({
    data: [
      { id: 10, entity_type: 'lead', key: 'sede', label: 'Sede', field_type: 'text', required: true, options: [], position: 0, is_active: true },
      { id: 11, entity_type: 'lead', key: 'autorizado', label: 'Autorizado', field_type: 'boolean', required: false, options: [], position: 1, is_active: true },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))

function renderDialog(onSubmit = vi.fn()) {
  render(
    <LeadFormDialog
      title="Editar lead"
      submitLabel="Guardar"
      initial={{ name: 'Ana', servicio_interes: 'Botox' }}
      canEditPhone={false}
      isSubmitting={false}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  )
  return onSubmit
}

describe('LeadFormDialog service catalog', () => {
  beforeEach(() => {
    mocks.createService.mockReset()
  })

  it('permite elegir un servicio consistente desde el catálogo', async () => {
    const user = userEvent.setup()
    const onSubmit = renderDialog()

    await user.click(screen.getByLabelText('Servicio de interés'))
    await user.click(screen.getByRole('option', { name: 'Limpieza facial' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      servicio_interes: 'Limpieza facial',
    }))
  })

  it('permite crear un nuevo servicio desde el formulario', async () => {
    const user = userEvent.setup()
    const onSubmit = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Crear servicio' }))
    await user.type(screen.getByPlaceholderText('Nombre del nuevo servicio'), 'Hollywood Peel')
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(mocks.createService).toHaveBeenCalledWith('Hollywood Peel', expect.any(Object))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('LeadFormDialog catálogo de etapas', () => {
  it('permite cambiar a una etapa añadida al catálogo del negocio', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const stageCatalog = buildStageCatalog([
      ...DEFAULT_LEAD_STAGES,
      {
        key: 'evaluacion_medica',
        name: 'Evaluación médica',
        color: '#14b8a6',
        kind: 'open',
        position: 20,
        is_active: true,
        description: null,
        is_system: false,
        on_appointment: false,
      },
    ])

    render(
      <LeadFormDialog
        title="Editar lead"
        submitLabel="Guardar"
        initial={{ name: 'Ana' }}
        initialStage="nuevo"
        stageCatalog={stageCatalog}
        canEditPhone={false}
        isSubmitting={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )

    await user.click(screen.getByLabelText('Etapa del chat'))
    const customStage = screen.getByRole('option', { name: 'Evaluación médica' })
    expect(customStage.querySelector('[data-stage-color="#14b8a6"]')).not.toBeNull()
    await user.click(customStage)
    expect(screen.getByLabelText('Etapa del chat').querySelector('[data-stage-color="#14b8a6"]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.any(Object), 'evaluacion_medica')
  })

  it('conserva visible una etapa actual que fue desactivada', () => {
    const stageCatalog = buildStageCatalog(DEFAULT_LEAD_STAGES.map(stage =>
      stage.key === 'calificado' ? { ...stage, is_active: false } : stage,
    ))

    render(
      <LeadFormDialog
        title="Editar lead"
        submitLabel="Guardar"
        initial={{ name: 'Ana' }}
        initialStage="calificado"
        stageCatalog={stageCatalog}
        canEditPhone={false}
        isSubmitting={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Etapa del chat')).toHaveTextContent('Calificado (inactiva)')
  })

  it('actualiza la etapa mientras el editor está abierto si el chat se mueve desde otro lugar', () => {
    const stageCatalog = buildStageCatalog(DEFAULT_LEAD_STAGES)
    const commonProps = {
      title: 'Editar lead',
      submitLabel: 'Guardar',
      initial: { name: 'Ana' },
      stageCatalog,
      canEditPhone: false,
      isSubmitting: false,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    }
    const { rerender } = render(<LeadFormDialog {...commonProps} initialStage="nuevo" />)

    expect(screen.getByLabelText('Etapa del chat')).toHaveTextContent('Nuevo')

    rerender(<LeadFormDialog {...commonProps} initialStage="en_diagnostico" />)

    expect(screen.getByLabelText('Etapa del chat')).toHaveTextContent('En diagnóstico')
  })
})

describe('LeadFormDialog alta con campos del negocio', () => {
  it('envía los valores al crear el lead y no muestra el campo fijo de especialista', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <LeadFormDialog
        title="Nuevo lead"
        submitLabel="Crear"
        requirePhoneAndName
        isSubmitting={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )

    await user.type(screen.getByPlaceholderText('906 471 403'), '987654321')
    await user.type(screen.getByPlaceholderText('Nombre del lead'), 'Ana')
    await user.type(screen.getByLabelText('Sede *'), 'Centro')
    await user.click(screen.getByRole('button', { name: 'Crear' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      custom_fields: { sede: 'Centro', autorizado: false },
    }))
    expect(screen.queryByText('Derivado a un especialista')).not.toBeInTheDocument()
  })
})

describe('LeadFormDialog compatibilidad de datos anteriores', () => {
  it('conserva el dato histórico de especialista sin ofrecerlo ni sobrescribirlo al editar', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <LeadFormDialog
        title="Editar lead"
        submitLabel="Guardar"
        initial={{ name: 'Ana', con_especialista: true }}
        canEditPhone={false}
        isSubmitting={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.queryByText('Derivado a un especialista')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('con_especialista')
  })
})

describe('LeadFormDialog teléfono secundario', () => {
  it('se puede editar aunque el teléfono principal esté bloqueado', async () => {
    const user = userEvent.setup()
    const onSubmit = renderDialog()

    await user.type(screen.getByLabelText('Teléfono secundario'), '987 654 321')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      secondary_phone: '987 654 321',
    }))
  })

  it('precarga el valor existente al editar', () => {
    render(
      <LeadFormDialog
        title="Editar lead"
        submitLabel="Guardar"
        initial={{ name: 'Ana', secondary_phone: '+51900111222' }}
        canEditPhone={false}
        isSubmitting={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Teléfono secundario')).toHaveValue('+51900111222')
  })

  it('manda null cuando se lo deja vacío', async () => {
    const user = userEvent.setup()
    const onSubmit = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      secondary_phone: null,
    }))
  })
})

describe('LeadFormDialog teléfono principal sin resolver', () => {
  it('avisa que un número mal tipeado redirige la conversación a otra persona', () => {
    render(
      <LeadFormDialog
        title="Editar lead"
        submitLabel="Guardar"
        initial={{ name: 'Ana' }}
        canEditPhone
        phoneEditIsRisky
        isSubmitting={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText(/los próximos mensajes se le van a mandar a otra persona/)).toBeInTheDocument()
  })

  it('no avisa cuando el teléfono ya está resuelto (edición normal)', () => {
    render(
      <LeadFormDialog
        title="Editar lead"
        submitLabel="Guardar"
        initial={{ name: 'Ana', phone: '51900111222' }}
        canEditPhone
        phoneEditIsRisky={false}
        isSubmitting={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.queryByText(/los próximos mensajes se le van a mandar a otra persona/)).not.toBeInTheDocument()
  })

  it('no avisa cuando el teléfono sigue bloqueado', () => {
    render(
      <LeadFormDialog
        title="Editar lead"
        submitLabel="Guardar"
        initial={{ name: 'Ana' }}
        canEditPhone={false}
        phoneEditIsRisky
        isSubmitting={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.queryByText(/los próximos mensajes se le van a mandar a otra persona/)).not.toBeInTheDocument()
  })
})

describe('LeadFormDialog llegando desde otra pantalla a cambiar el servicio', () => {
  it('resalta el servicio de interés, le da el foco y dice para qué', () => {
    render(
      <LeadFormDialog
        title="Editar lead"
        submitLabel="Guardar"
        initial={{ name: 'Ana', servicio_interes: 'Botox' }}
        canEditPhone={false}
        isSubmitting={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        highlightService={{ reason: 'Cámbialo o quítalo para poder eliminar «Botox» del catálogo.' }}
      />,
    )

    const service = screen.getByLabelText('Servicio de interés')
    expect(service).toHaveFocus()
    expect(service.closest('[data-highlighted="true"]')).not.toBeNull()
    expect(screen.getByText(/para poder eliminar «Botox» del catálogo/)).toBeInTheDocument()
  })

  it('sin pedido de otra pantalla, nada resaltado', () => {
    renderDialog()
    expect(document.querySelector('[data-highlighted="true"]')).toBeNull()
  })
})
