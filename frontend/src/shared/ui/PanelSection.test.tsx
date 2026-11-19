import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PanelSection, PanelSectionAction } from './PanelSection'

describe('PanelSection', () => {
  beforeEach(() => localStorage.removeItem('seccion-prueba'))

  it('pliega el contenido y recuerda el estado en el equipo', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <PanelSection title="Datos" storageKey="seccion-prueba">
        <p>Teléfono</p>
      </PanelSection>,
    )

    const toggle = screen.getByRole('button', { name: 'Datos' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Teléfono')).toBeVisible()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Teléfono')).not.toBeVisible()
    unmount()

    render(<PanelSection title="Datos" storageKey="seccion-prueba"><p>Teléfono</p></PanelSection>)
    expect(screen.getByRole('button', { name: 'Datos' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('la acción no pliega la sección', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(
      <PanelSection title="Seguimiento" count={2} action={<PanelSectionAction label="Crear tarea" onClick={onAdd}><span /></PanelSectionAction>}>
        <p>Llamar</p>
      </PanelSection>,
    )

    await user.click(screen.getByRole('button', { name: 'Crear tarea' }))
    expect(onAdd).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: /Seguimiento/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: 'Seguimiento' })).toHaveTextContent('2')
  })
})
