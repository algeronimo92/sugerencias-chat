import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Sidebar } from './Sidebar'

function renderRail(role: string, path = '/') {
  const handlers = { onToggleTheme: vi.fn(), onLogout: vi.fn(), onOpenSettings: vi.fn(), onOpenSecurity: vi.fn() }
  render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar
        role={role}
        unreadCount={128}
        brandName="Clínica Norte"
        account={{ name: 'Ana Torres', role: 'Administrador', onOpenSecurity: handlers.onOpenSecurity }}
        theme="light"
        onToggleTheme={handlers.onToggleTheme}
        onLogout={handlers.onLogout}
        onOpenSettings={role === 'admin' ? handlers.onOpenSettings : undefined}
      />
    </MemoryRouter>,
  )
  return handlers
}

describe('riel lateral', () => {
  beforeEach(() => localStorage.clear())

  it('agrupa las vistas del admin y marca la actual como página', () => {
    renderRail('admin', '/kanban')

    const nav = screen.getByRole('navigation', { name: 'Vista principal' })
    expect(within(nav).getByRole('link', { name: 'Embudo' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: /Chats/ })).not.toHaveAttribute('aria-current')
    expect(within(within(nav).getByRole('group', { name: 'Herramientas' })).getAllByRole('link').map(link => link.textContent))
      .toEqual(['Flujos enviados', 'Automatizaciones', 'Plantillas'])
    expect(within(nav).getByRole('group', { name: 'Configuración' })).toBeInTheDocument()
  })

  it('al vendedor no le muestra herramientas de admin ni configuración', () => {
    renderRail('vendedor')

    const nav = screen.getByRole('navigation', { name: 'Vista principal' })
    expect(within(nav).queryByRole('group', { name: 'Configuración' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Automatizaciones' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configuración' })).not.toBeInTheDocument()
  })

  it('el contador de chats es el común: 99+ con el total en el nombre', () => {
    renderRail('vendedor')

    expect(screen.getByText('99+')).toHaveAttribute('aria-label', '128')
  })

  it('expandir muestra las etiquetas y queda recordado', async () => {
    renderRail('admin')

    expect(screen.queryByText('Clínica Norte')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Expandir menú' }))

    expect(screen.getByText('Clínica Norte')).toBeInTheDocument()
    expect(screen.getByText('Herramientas')).toBeVisible()
    expect(localStorage.getItem('rail-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Contraer menú' })).toBeInTheDocument()
  })

  it('expandido, las herramientas van en una fila de iconos y no como vistas', async () => {
    localStorage.setItem('rail-expanded', 'true')
    renderRail('admin')

    const settings = screen.getByRole('button', { name: 'Configuración' })
    const help = screen.getByRole('button', { name: 'Ayuda y reportes' })
    // Sin etiqueta visible: el nombre lo dan aria-label y el tooltip.
    expect(settings).toHaveTextContent('')
    expect(help).toHaveTextContent('')
    expect(settings.parentElement).toBe(help.parentElement)
  })

  it('ayuda y cuenta reúnen lo que antes eran iconos sueltos', async () => {
    renderRail('admin')

    // Cuatro accesos fijos abajo, sin tema ni cerrar sesión sueltos.
    expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Activar modo oscuro' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Reportes' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Ayuda y reportes' }))
    expect(await screen.findByRole('menuitem', { name: 'Ver mis reportes' })).toBeInTheDocument()
  })

  it('el menú de la cuenta abre seguridad, cambia el tema y cierra sesión', async () => {
    const handlers = renderRail('admin')
    const account = screen.getByRole('button', { name: 'Menú de la cuenta' })

    await userEvent.click(account)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Acceso y seguridad' }))
    await userEvent.click(account)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Modo oscuro' }))
    await userEvent.click(account)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cerrar sesión' }))

    expect(handlers.onOpenSecurity).toHaveBeenCalledOnce()
    expect(handlers.onToggleTheme).toHaveBeenCalledOnce()
    expect(handlers.onLogout).toHaveBeenCalledOnce()
  })
})
