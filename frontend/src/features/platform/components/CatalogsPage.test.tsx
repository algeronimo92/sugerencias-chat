import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CatalogsPage } from './CatalogsPage'

vi.mock('../../catalogs/components/ServicesManagementPanel', () => ({
  ServicesManagementPanel: () => <div>Panel de servicios</div>,
}))
vi.mock('../../catalogs/components/TagsManagementPanel', () => ({
  TagsManagementPanel: () => <div>Panel de etiquetas</div>,
}))
vi.mock('../../templates/components/TemplateCategoriesManagementPanel', () => ({
  TemplateCategoriesManagementPanel: () => <div>Panel de categorías de plantillas</div>,
}))
vi.mock('../../leads/components/LeadStagesManagementPanel', () => ({
  LeadStagesManagementPanel: () => <div>Panel de etapas</div>,
}))
vi.mock('../../catalogs/components/CustomFieldsManagementPanel', () => ({
  CustomFieldsManagementPanel: () => <div>Panel de campos personalizados</div>,
}))

describe('CatalogsPage', () => {
  it('agrupa servicios y etiquetas en una página propia', async () => {
    const user = userEvent.setup()
    render(<CatalogsPage />)

    expect(screen.getByRole('heading', { name: 'Catálogos' })).toBeInTheDocument()
    expect(screen.getByText('Panel de servicios')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Etiquetas' }))
    expect(screen.getByText('Panel de etiquetas')).toBeInTheDocument()
    expect(screen.queryByText('Panel de servicios')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Categorías de plantillas' }))
    expect(screen.getByText('Panel de categorías de plantillas')).toBeInTheDocument()
    expect(screen.queryByText('Panel de etiquetas')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Etapas' }))
    expect(screen.getByText('Panel de etapas')).toBeInTheDocument()
  })
})
