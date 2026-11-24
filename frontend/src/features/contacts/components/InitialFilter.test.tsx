import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { InitialFilter } from './InitialFilter'

describe('InitialFilter', () => {
  it('marca la inicial elegida y tiene la Ñ entre la N y la O', () => {
    render(<InitialFilter value="Ñ" onChange={vi.fn()} />)
    const buttons = screen.getAllByRole('button')
    const labels = buttons.map(button => button.textContent)
    expect(labels.indexOf('Ñ')).toBe(labels.indexOf('N') + 1)
    expect(labels.at(0)).toBe('Todos')
    expect(labels.at(-1)).toBe('#')
    expect(screen.getByRole('button', { name: 'Nombres con Ñ' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Todos los contactos' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('es un solo punto de tabulación: las flechas mueven el foco y Intro elige', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InitialFilter value="" onChange={onChange} />)

    await user.tab()
    expect(screen.getByRole('button', { name: 'Todos los contactos' })).toHaveFocus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('button', { name: 'Nombres con B' })).toHaveFocus()
    // Mover el foco no filtra: así no se pide una página por tecla.
    expect(onChange).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('B')

    await user.keyboard('{End}')
    expect(screen.getByRole('button', { name: '#, nombres que no empiezan con letra' })).toHaveFocus()
    // Tab sale de la fila en vez de recorrer las 29 opciones.
    await user.tab()
    expect(document.body).toHaveFocus()
  })
})
