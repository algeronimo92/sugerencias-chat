import { render, screen } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { RouteError } from './RouteError'

function Broken({ error }: { error: unknown }): never {
  throw error
}

function renderRoute(error: unknown) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <div><nav>Barra lateral</nav><Outlet /></div>,
      children: [{ errorElement: <RouteError />, children: [{ index: true, element: <Broken error={error} /> }] }],
    },
  ])
  render(<RouterProvider router={router} />)
}

describe('RouteError', () => {
  it('una pantalla rota muestra el aviso y deja el layout en pie', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderRoute(new Error('Se rompió el kanban'))

    expect(screen.getByRole('alert')).toHaveTextContent('Esta pantalla tuvo un problema')
    expect(screen.getByRole('alert')).toHaveTextContent('Se rompió el kanban')
    expect(screen.getByText('Barra lateral')).toBeInTheDocument()
  })

  it('un chunk viejo tras publicar pide recargar', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderRoute(new TypeError('Failed to fetch dynamically imported module: /assets/KanbanBoard.js'))

    expect(screen.getByRole('alert')).toHaveTextContent('Hay una versión nueva')
    expect(screen.queryByRole('button', { name: 'Ir al inicio' })).not.toBeInTheDocument()
  })
})
