import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TemplateCategoriesManagementPanel } from './TemplateCategoriesManagementPanel'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('../hooks/useTemplateCategories', () => ({
  useTemplateCategories: () => ({
    data: [
      { id: 1, name: 'Seguimiento', is_active: true, created_by_name: 'Lucía Ramos' },
      { id: 2, name: 'Anterior', is_active: false, created_by_name: null },
    ],
    isLoading: false,
    error: null,
  }),
  useCreateTemplateCategory: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateTemplateCategory: () => ({ mutate: mocks.update, isPending: false, variables: undefined }),
}))

describe('TemplateCategoriesManagementPanel', () => {
  beforeEach(() => {
    mocks.create.mockReset()
    mocks.update.mockReset()
  })

  it('crea categorías desde el catálogo', async () => {
    const user = userEvent.setup()
    render(<TemplateCategoriesManagementPanel />)

    await user.type(screen.getByPlaceholderText('Nombre de la nueva categoría'), 'Postventa')
    await user.click(screen.getByRole('button', { name: 'Crear categoría' }))

    expect(mocks.create).toHaveBeenCalledWith('Postventa', expect.any(Object))
  })

  it('muestra el creador y permite desactivar sin borrar', async () => {
    const user = userEvent.setup()
    render(<TemplateCategoriesManagementPanel />)

    expect(screen.getByText('Creada por Lucía Ramos')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Activa' }))

    expect(mocks.update).toHaveBeenCalledWith(
      { id: 1, is_active: false },
      expect.any(Object),
    )
  })
})
