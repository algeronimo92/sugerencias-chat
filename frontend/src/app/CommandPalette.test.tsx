import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createTestQueryClient, queryWrapper } from '../test/queryWrapper'
import { CommandPalette } from './CommandPalette'

describe('CommandPalette', () => {
  it('Ctrl+K abre la búsqueda y filtra las pantallas por nombre sin tildes', async () => {
    const user = userEvent.setup()
    render(<CommandPalette role="vendedor" />, { wrapper: queryWrapper(createTestQueryClient()) })

    expect(screen.queryByRole('combobox')).toBeNull()
    await user.keyboard('{Control>}k{/Control}')
    const input = await screen.findByRole('combobox')
    expect(screen.getByRole('option', { name: /Kanban/ })).toBeTruthy()
    // Pantallas de admin no aparecen para un vendedor.
    expect(screen.queryByRole('option', { name: /Plantillas/ })).toBeNull()

    await user.type(input, 'tareas')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['TareasIr a'])
  })

  it('Enter ejecuta la opción activa y cierra', async () => {
    const user = userEvent.setup()
    const onOpenSettings = vi.fn()
    render(<CommandPalette role="admin" onOpenSettings={onOpenSettings} />, { wrapper: queryWrapper(createTestQueryClient()) })

    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByRole('combobox'), 'configuracion{Enter}')
    expect(onOpenSettings).toHaveBeenCalledOnce()
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
