import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageTemplate, TemplateAttachment } from '../types'
import { EditTemplateDialog } from './EditTemplateDialog'

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  upload: vi.fn(),
  library: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
}))

vi.mock('../hooks/useTemplates', () => ({
  useUpdateTemplate: () => ({ mutateAsync: mocks.update, isPending: false }),
  useUploadTemplateAttachment: () => ({ mutateAsync: mocks.upload, isPending: false }),
  useAddLibraryTemplateAttachment: () => ({ mutateAsync: mocks.library, isPending: false }),
  useDeleteTemplateAttachment: () => ({ mutateAsync: mocks.remove, isPending: false }),
  useReorderTemplateAttachments: () => ({ mutateAsync: mocks.reorder, isPending: false }),
}))

vi.mock('../../media/public/MediaLibraryPicker', () => ({ MediaLibraryPicker: () => null }))

function attachment(id: number, filename: string, content_type = 'image/jpeg', position = id): TemplateAttachment {
  return { id, filename, content_type, position, media_url: `/media/${filename}`, library_asset_id: null }
}

function template(overrides: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    id: 5, name: 'Bienvenida', content: 'Hola {{nombre}}', template_type: 'internal', interactive_type: 'none',
    official_parameter_values: [], meta_template_id: null, attachments: [],
    ...overrides,
  } as MessageTemplate
}

const metaTemplate = () => template({
  name: 'Seguimiento', template_type: 'official', content: 'Hola {{1}}',
  official_status: 'APPROVED', official_parameter_values: ['{{nombre}}'], meta_template_id: '123',
})

describe('EditTemplateDialog', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.update.mockImplementation(async (values: Partial<MessageTemplate>) => ({ ...template(), ...values }))
  })

  it('guarda el nombre y el texto de una plantilla interna', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<EditTemplateDialog template={template()} onClose={onClose} />)

    const content = screen.getByRole('textbox', { name: 'Mensaje' })
    await user.clear(content)
    await user.type(content, 'Hola de nuevo')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(mocks.update).toHaveBeenCalledWith({ id: 5, name: 'Bienvenida', content: 'Hola de nuevo' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    // Sin cambios de archivos, no toca los adjuntos.
    expect(mocks.reorder).not.toHaveBeenCalled()
  })

  it('no avisa de revisión si una plantilla de Meta solo cambia de nombre', async () => {
    const user = userEvent.setup()
    render(<EditTemplateDialog template={metaTemplate()} onClose={vi.fn()} />)

    const name = screen.getByRole('textbox', { name: 'Nombre' })
    await user.clear(name)
    await user.type(name, 'Seguimiento 7 días')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(mocks.update).toHaveBeenCalledWith(
      { id: 5, name: 'Seguimiento 7 días', content: 'Hola {{1}}', official_parameter_values: ['{{nombre}}'] },
    )
  })

  it('avisa que cambiar el texto de una de Meta la manda otra vez a revisión', async () => {
    const user = userEvent.setup()
    render(<EditTemplateDialog template={metaTemplate()} onClose={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: 'Mensaje' }), ', ¿seguimos?')

    expect(screen.getByRole('alert')).toHaveTextContent('Meta vuelve a revisar la plantilla')
    expect(screen.getByRole('button', { name: 'Guardar y enviar a revisión' })).toBeInTheDocument()
  })

  it('una de Meta no muestra archivos: su encabezado se cambia en Plantillas', () => {
    render(<EditTemplateDialog template={metaTemplate()} onClose={vi.fn()} />)

    expect(screen.queryByRole('heading', { name: 'Archivos' })).not.toBeInTheDocument()
  })

  it('marca qué archivo lleva el texto y lo actualiza al reordenar', async () => {
    const user = userEvent.setup()
    const saved = [attachment(1, 'nota.ogg', 'audio/ogg'), attachment(2, 'foto.jpg'), attachment(3, 'guia.pdf', 'application/pdf')]
    render(<EditTemplateDialog template={template({ attachments: saved })} onClose={vi.fn()} />)

    const rows = () => within(screen.getByRole('list', { name: 'Archivos en el orden en que se envían' })).getAllByRole('listitem')
    // El audio no admite pie: el texto va en la foto.
    expect(rows()[1]).toHaveTextContent('Lleva el texto')

    await user.click(screen.getByRole('button', { name: 'Subir guia.pdf' }))
    expect(rows()[1]).toHaveTextContent('guia.pdf')
    expect(rows()[1]).toHaveTextContent('Lleva el texto')
  })

  it('al guardar quita y fija el orden elegido; cancelar no cambia nada', async () => {
    const user = userEvent.setup()
    const saved = [attachment(1, 'a.jpg'), attachment(2, 'b.jpg'), attachment(3, 'c.jpg')]
    const { unmount } = render(<EditTemplateDialog template={template({ attachments: saved })} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Quitar b.jpg' }))
    await user.click(screen.getByRole('button', { name: 'Subir c.jpg' }))
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(mocks.reorder).toHaveBeenCalledWith({ templateId: 5, attachmentIds: [3, 1] }))
    expect(mocks.remove).toHaveBeenCalledWith(2)
    unmount()

    for (const mock of Object.values(mocks)) mock.mockClear()
    const onClose = vi.fn()
    render(<EditTemplateDialog template={template({ attachments: saved })} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Quitar a.jpg' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})
