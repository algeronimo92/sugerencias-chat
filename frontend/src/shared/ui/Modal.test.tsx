import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Modal } from './Modal'

describe('Modal', () => {
  it('se anuncia como diálogo con su título y se cierra con Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Modal title="Editar plantilla" description="Los cambios se ven en todos los flujos." onClose={onClose}>cuerpo</Modal>)

    expect(screen.getByRole('dialog', { name: 'Editar plantilla' })).toHaveAccessibleDescription('Los cambios se ven en todos los flujos.')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('mientras guarda no se cierra con Escape ni con la X', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Modal title="Guardando" busy onClose={onClose}>cuerpo</Modal>)

    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeDisabled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('una pregunta se anuncia como alerta', () => {
    render(<Modal alert title="Hay cambios sin guardar" onClose={vi.fn()} />)

    expect(screen.getByRole('alertdialog', { name: 'Hay cambios sin guardar' })).toBeInTheDocument()
  })

  it('muestra las acciones del pie', () => {
    render(<Modal title="Nueva plantilla" onClose={vi.fn()} footer={<button type="button">Crear plantilla</button>} />)

    expect(screen.getByRole('button', { name: 'Crear plantilla' })).toBeInTheDocument()
  })
})
