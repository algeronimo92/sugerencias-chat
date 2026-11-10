import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChatHeaderMoreMenu } from './ChatHeaderMoreMenu'

function renderMenu(props: Partial<React.ComponentProps<typeof ChatHeaderMoreMenu>> = {}) {
  const handlers = { onToggleConversation: vi.fn(), onToggleAutomation: vi.fn() }
  render(<ChatHeaderMoreMenu conversationOpen automationPaused={false} disabled={false} {...handlers} {...props} />)
  return handlers
}

describe('ChatHeaderMoreMenu', () => {
  it('agrupa abrir o cerrar la conversación y las automatizaciones, y cada opción hace lo suyo', async () => {
    const user = userEvent.setup()
    const { onToggleConversation, onToggleAutomation } = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Más acciones' }))
    await user.click(screen.getByRole('menuitem', { name: /Cerrar conversación/ }))
    expect(onToggleConversation).toHaveBeenCalledTimes(1)
    // Elegir una opción cierra el menú.
    expect(screen.queryByRole('menu')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Más acciones' }))
    await user.click(screen.getByRole('menuitem', { name: /No iniciar automatizaciones nuevas/ }))
    expect(onToggleAutomation).toHaveBeenCalledTimes(1)
  })

  it('avisa en el botón cuando la conversación está cerrada o las automatizaciones pausadas', async () => {
    const user = userEvent.setup()
    renderMenu({ conversationOpen: false, automationPaused: true })

    await user.click(screen.getByRole('button', { name: 'Más acciones (hay algo para revisar)' }))
    expect(screen.getByRole('menuitem', { name: /Abrir conversación/ })).toHaveTextContent('Ahora está cerrada')
    expect(screen.getByRole('menuitem', { name: /Reactivar automatizaciones nuevas/ })).toHaveTextContent('Ahora están pausadas')
  })
})
