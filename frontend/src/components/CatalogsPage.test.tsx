import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CatalogsPage } from './CatalogsPage'

vi.mock('./ServicesManagementPanel', () => ({
  ServicesManagementPanel: () => <div>Panel de servicios</div>,
}))
vi.mock('./TagsManagementPanel', () => ({
  TagsManagementPanel: () => <div>Panel de etiquetas</div>,
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
  })
})
