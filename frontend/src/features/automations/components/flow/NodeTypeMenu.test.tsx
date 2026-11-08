import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NodeTypeMenu } from './NodeTypeMenu'

describe('NodeTypeMenu', () => {
  it('ofrece los tipos de bloque, con el foco en el primero, y devuelve el elegido', async () => {
    const onPick = vi.fn()
    render(<NodeTypeMenu x={100} y={100} onPick={onPick} onClose={vi.fn()} />)

    const items = screen.getAllByRole('menuitem')
    expect(items.map(item => item.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Fin'), expect.stringContaining('Pregunta')]))
    expect(screen.queryByRole('menuitem', { name: /Disparador/ })).toBeNull()
    expect(items[0]).toHaveFocus()

    await userEvent.keyboard('{ArrowUp}')
    expect(items.at(-1)).toHaveFocus()
    await userEvent.click(screen.getByRole('menuitem', { name: /Fin/ }))
    expect(onPick).toHaveBeenCalledWith('end')
  })

  it('se cierra con Escape o tocando fuera', () => {
    const onClose = vi.fn()
    render(<><button type="button">afuera</button><NodeTypeMenu x={100} y={100} onPick={vi.fn()} onClose={onClose} /></>)

    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'afuera' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
