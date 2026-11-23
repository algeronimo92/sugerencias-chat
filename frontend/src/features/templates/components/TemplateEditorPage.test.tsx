import { configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { saveTemplateDraft, templateIdsWithDraft } from '../domain/templateDraftStorage'
import { EMPTY_TEMPLATE_FORM } from '../domain/templateForm'
import type { MessageTemplate } from '../types'
import { TemplateEditorPage } from './TemplateEditorPage'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  templates: [] as unknown[],
  capabilities: {
    integration: 'meta', official_sending_supported: true, reason: null, interactive_default_footer: 'DermicaPro',
    interactive_limits: {
      text: 4096, body: 1024, title: 60, footer: 60, button_text: 20, button_id: 256, max_buttons: 3,
      list_button_text: 20, section_title: 24, row_title: 24, row_description: 72, row_id: 200, max_sections: 10, max_rows: 10,
    },
  },
}))

vi.mock('../hooks/useTemplates', () => ({
  useTemplates: () => ({ data: mocks.templates, isLoading: false }),
  useTemplateCapabilities: () => ({ data: mocks.capabilities, isLoading: false }),
  useCreateTemplate: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateTemplate: () => ({ mutateAsync: mocks.update, isPending: false }),
  useUploadTemplateAttachment: () => ({ mutateAsync: mocks.upload, isPending: false }),
  useAddLibraryTemplateAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTemplateAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReorderTemplateAttachments: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../hooks/useTemplateCategories', () => ({
  useTemplateCategories: () => ({ data: [{ id: 1, name: 'Seguimiento' }, { id: 2, name: 'ventas' }], isLoading: false }),
  useCreateTemplateCategory: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../../media/public/queries', () => ({ useMediaLibrary: () => ({ data: [] }) }))
vi.mock('../../media/public/MediaLibraryPicker', () => ({ MediaLibraryPicker: () => null }))
vi.mock('../../media/public/MediaAssetField', () => ({ MediaAssetField: () => null }))
vi.mock('../../leads/public/useLeadStages', () => ({ useLeadStageCatalog: () => ({ active: [], get: () => undefined }) }))
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }))

function template(overrides: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    id: 5, name: 'Hifu', content: 'Hola {{nombre}}', shortcut: null, category: 'ventas', stage: null, task_type: null,
    template_type: 'internal', interactive_type: 'none', interactive_config: {}, official_name: null, official_language: null,
    official_category: null, official_status: null, official_rejected_reason: null, official_parameter_values: [],
    official_header_type: 'none', official_header_text: null, official_header_media_asset_id: null, official_footer: null,
    official_buttons: [], meta_template_id: null, attachments: [], is_active: true, use_count: 0,
    ...overrides,
  } as MessageTemplate
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/templates" element={<p>Lista de plantillas</p>} />
        <Route path="/templates/nueva" element={<TemplateEditorPage />} />
        <Route path="/templates/:templateId" element={<TemplateEditorPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// La acción principal está arriba (escritorio) y abajo (celular): jsdom no
// aplica el CSS que muestra una sola.
const submitButton = (name: string) => screen.getAllByRole('button', { name })[0]
const nameField = () => screen.getByRole('textbox', { name: /^Nombre \(obligatorio\)/ })
const messageField = () => screen.getByRole('textbox', { name: /^Texto del mensaje/ })

// Estas pruebas recorren el formulario entero (escribir, abrir un menú,
// subir un archivo, navegar). Con la suite completa en paralelo, el segundo
// de espera por defecto no alcanzaba y fallaba una distinta en cada corrida.
configure({ asyncUtilTimeout: 5000 })

describe('TemplateEditorPage', { timeout: 20_000 }, () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.templates = []
    for (const mock of [mocks.create, mocks.update, mocks.upload, mocks.toastSuccess, mocks.toastError]) mock.mockReset()
    mocks.create.mockImplementation(async (values: Partial<MessageTemplate>) => {
      const saved = template({ ...values, id: 9 })
      mocks.templates = [saved]
      return saved
    })
    mocks.update.mockImplementation(async (values: Partial<MessageTemplate>) => template(values))
  })

  it('muestra cada error junto a su campo y lleva el foco al primero, sin guardar', async () => {
    const user = userEvent.setup()
    renderAt('/templates/nueva')

    await user.click(submitButton('Guardar plantilla'))

    expect(nameField()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('El nombre es obligatorio.')).toBeInTheDocument()
    expect(screen.getByText('El contenido es obligatorio.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Falta corregir 2 puntos' })).toBeInTheDocument()
    await waitFor(() => expect(nameField()).toHaveFocus())
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('cada campo muestra cuánto lleva y frena en su tope', async () => {
    const user = userEvent.setup()
    renderAt('/templates/nueva')

    await user.type(nameField(), 'Hifu')
    expect(nameField()).toHaveAttribute('maxlength', '120')
    expect(screen.getByText('4 / 120')).toBeInTheDocument()
    expect(messageField()).toHaveAttribute('maxlength', '4096')

    // Con botones el texto pasa a ser el cuerpo de un interactivo: tope menor.
    await user.click(screen.getByRole('radio', { name: 'Con botones de respuesta' }))
    expect(messageField()).toHaveAttribute('maxlength', '1024')
    expect(screen.getByRole('textbox', { name: 'Texto del botón 1' })).toHaveAttribute('maxlength', '20')
    expect(screen.getByRole('textbox', { name: /^Atajo/ })).toHaveAttribute('maxlength', '50')
  })

  it('una oficial arma su nombre de Meta, une el dato a la variable y se envía a revisión', async () => {
    const user = userEvent.setup()
    renderAt('/templates/nueva')

    await user.click(screen.getByRole('radio', { name: /Escribir primero o después de 24 horas/ }))
    await user.type(nameField(), 'Aviso de cita')
    expect(screen.getByText('aviso_de_cita')).toBeInTheDocument()

    await user.type(messageField(), 'Hola ')
    await user.click(screen.getByRole('button', { name: 'Insertar dato' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Nombre' }))
    await waitFor(() => expect(messageField()).toHaveValue('Hola {{1}}'))
    // El menú devuelve el foco al cerrarse: si eso pasa a mitad de la
    // escritura, se pierden letras. Se espera a que termine de cerrarse.
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await user.type(messageField(), ', tu cita quedó registrada.')

    expect(screen.getByText('Ana')).toBeInTheDocument()
    const checklist = screen.getByRole('region', { name: 'Antes de enviarla' })
    expect(within(checklist).queryByText(/Por revisar/)).not.toBeInTheDocument()

    await user.click(submitButton('Enviar a revisión de Meta'))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      template_type: 'official', name: 'Aviso de cita', official_name: 'aviso_de_cita', official_language: 'es',
      official_category: 'UTILITY', content: 'Hola {{1}}, tu cita quedó registrada.', official_parameter_values: ['{{nombre}}'],
    }))
    expect(await screen.findByText('Lista de plantillas')).toBeInTheDocument()
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Enviada a revisión de Meta', expect.anything())
  })

  it('avisa que una aprobada vuelve a revisión solo cuando cambia lo que Meta revisa', async () => {
    const user = userEvent.setup()
    mocks.templates = [template({
      template_type: 'official', name: 'Aviso', official_name: 'aviso', official_language: 'es', official_category: 'UTILITY',
      official_status: 'APPROVED', meta_template_id: '123', content: 'Hola {{1}}, te esperamos.', official_parameter_values: ['{{nombre}}'],
    })]
    renderAt('/templates/5')

    expect(screen.getByText('Esta plantilla está aprobada')).toBeInTheDocument()
    expect(screen.getByText(/una vez cada 24 horas y diez veces cada 30 días/)).toBeInTheDocument()
    expect(submitButton('Guardar cambios')).toBeInTheDocument()
    // Meta no deja cambiar la categoría de una aprobada.
    expect(screen.getByRole('radio', { name: /^Promoción/ })).toBeDisabled()
    expect(messageField()).toBeEnabled()

    await user.type(messageField(), ' Gracias.')

    expect(screen.getByText('Al guardar, Meta vuelve a revisarla')).toBeInTheDocument()
    expect(submitButton('Enviar a revisión de Meta')).toBeInTheDocument()
  })

  it('en revisión bloquea el mensaje y el tipo, pero deja guardar el nombre', async () => {
    const user = userEvent.setup()
    mocks.templates = [template({
      template_type: 'official', name: 'Promo', official_name: 'promo', official_language: 'es', official_category: 'MARKETING',
      official_status: 'PENDING', meta_template_id: '902', content: 'Este mes tenemos una promoción para ti.',
    })]
    renderAt('/templates/5')

    expect(screen.getByText('Meta la está revisando')).toBeInTheDocument()
    expect(messageField()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Insertar dato' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /^Aviso/ })).toBeDisabled()

    await user.type(nameField(), ' de diciembre')
    await user.click(submitButton('Guardar cambios'))

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ id: 5, name: 'Promo de diciembre', content: 'Este mes tenemos una promoción para ti.' })))
  })

  it('con el cupo de 24 horas gastado avisa desde cuándo se puede y bloquea el mensaje', () => {
    const lastEdit = new Date(Date.now() - 5 * 60_000)
    mocks.templates = [template({
      template_type: 'official', name: 'Desde Instagram', official_name: 'desde_instagram', official_language: 'es',
      official_category: 'MARKETING', official_status: 'APPROVED', meta_template_id: '921', content: 'Hola, gracias por escribirnos.',
      official_last_edit_at: lastEdit.toISOString(), official_next_edit_at: new Date(lastEdit.getTime() + 24 * 3_600_000).toISOString(),
    })]
    renderAt('/templates/5')

    expect(screen.getByText(/^Ya enviaste un cambio a Meta hoy a las/)).toBeInTheDocument()
    expect(screen.getByText(/Meta acepta el próximo cambio en el mensaje desde mañana a las/)).toBeInTheDocument()
    expect(messageField()).toBeDisabled()
    expect(nameField()).toBeEnabled()
  })

  it('el respaldo local queda escrito en cuanto se cambia algo, sin esperar', async () => {
    const user = userEvent.setup()
    mocks.templates = [template()]
    renderAt('/templates/5')

    await user.type(nameField(), '!')

    // Sin temporizadores de por medio: salir del editor justo después de
    // escribir no puede perder el borrador.
    expect(templateIdsWithDraft()).toEqual([5])
  })

  it('si el guardado falla, dice que nada se guardó y que lo escrito sigue en el dispositivo', async () => {
    const user = userEvent.setup()
    mocks.templates = [template()]
    mocks.update.mockRejectedValue(new Error('Meta no aceptó el cambio'))
    renderAt('/templates/5')

    await user.type(messageField(), ' y algo más')
    await user.click(submitButton('Guardar cambios'))

    expect(await screen.findByText('Meta no aceptó el cambio')).toBeInTheDocument()
    expect(screen.getByText(/No se guardó ni se envió a Meta/)).toBeInTheDocument()
    expect(screen.queryByText('Lista de plantillas')).not.toBeInTheDocument()
  })

  it('guardar una rechazada la reenvía a revisión aunque no cambie el mensaje', () => {
    mocks.templates = [template({
      template_type: 'official', name: 'Pago', official_name: 'pago', official_language: 'es', official_category: 'UTILITY',
      official_status: 'REJECTED', official_rejected_reason: 'TAG_CONTENT_MISMATCH', meta_template_id: '901', content: 'Aprovecha 2x1 hoy.',
    })]
    renderAt('/templates/5')

    expect(screen.getByText('Meta la rechazó')).toBeInTheDocument()
    expect(submitButton('Enviar a revisión de Meta')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^Promoción/ })).toBeEnabled()
    expect(messageField()).toBeEnabled()
  })

  it('recupera el borrador que quedó sin guardar y deja descartarlo', async () => {
    const user = userEvent.setup()
    saveTemplateDraft(null, { form: { ...EMPTY_TEMPLATE_FORM, name: 'A medias', content: 'Hola' }, officialNameEdited: false, savedAt: Date.now() })
    renderAt('/templates/nueva')

    expect(nameField()).toHaveValue('A medias')
    expect(screen.getByText('Recuperamos lo que habías escrito')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(nameField()).toHaveValue('')
  })

  it('si un archivo falla después de crear, sigue en la plantilla guardada en vez de crear otra', async () => {
    const user = userEvent.setup()
    mocks.upload.mockRejectedValue(new Error('El archivo no se pudo subir'))
    const { container } = renderAt('/templates/nueva')

    await user.type(nameField(), 'Hifu')
    await user.type(messageField(), 'Hola')
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'foto.png', { type: 'image/png' }))
    await user.click(submitButton('Guardar plantilla'))

    // Ya no está en «crear»: la pantalla pasó a editar la que se guardó.
    expect(await screen.findByRole('heading', { name: 'Editar «Hifu»' })).toBeInTheDocument()
    expect(mocks.toastError).toHaveBeenCalledWith('La plantilla se guardó, pero un archivo no se pudo subir', expect.anything())

    await user.type(messageField(), ' de nuevo')
    await user.click(submitButton('Guardar cambios'))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ id: 9, content: 'Hola de nuevo' })))
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})
