import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageTemplate } from '../types'
import { EditTemplateDialog } from './EditTemplateDialog'

const mocks = vi.hoisted(() => ({ update: vi.fn() }))

vi.mock('../hooks/useTemplates', () => ({
  useUpdateTemplate: () => ({ mutate: mocks.update, isPending: false }),
}))

function template(overrides: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    id: 5, name: 'Bienvenida', content: 'Hola {{nombre}}', template_type: 'internal',
    official_parameter_values: [], meta_template_id: null, attachments: [],
    ...overrides,
  } as MessageTemplate
}

const metaTemplate = () => template({
  name: 'Seguimiento', template_type: 'official', content: 'Hola {{1}}',
  official_status: 'APPROVED', official_parameter_values: ['{{nombre}}'], meta_template_id: '123',
})

describe('EditTemplateDialog', () => {
  beforeEach(() => mocks.update.mockReset())

  it('guarda el nombre y el texto de una plantilla interna', async () => {
    const user = userEvent.setup()
    render(<EditTemplateDialog template={template()} onClose={vi.fn()} />)

    const content = screen.getByRole('textbox', { name: 'Mensaje' })
    await user.clear(content)
    await user.type(content, 'Hola de nuevo')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(mocks.update).toHaveBeenCalledWith(
      { id: 5, name: 'Bienvenida', content: 'Hola de nuevo' },
      expect.any(Object),
    )
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
      expect.any(Object),
    )
  })

  it('avisa que cambiar el texto de una de Meta la manda otra vez a revisión', async () => {
    const user = userEvent.setup()
    render(<EditTemplateDialog template={metaTemplate()} onClose={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: 'Mensaje' }), ', ¿seguimos?')

    expect(screen.getByRole('alert')).toHaveTextContent('Meta vuelve a revisar la plantilla')
    expect(screen.getByRole('button', { name: 'Guardar y enviar a revisión' })).toBeInTheDocument()
  })
})
