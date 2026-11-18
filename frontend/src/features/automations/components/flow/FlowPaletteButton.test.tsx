import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FLOW_PALETTE } from './flowPalette'
import { FlowPaletteButton } from './FlowPaletteButton'

const condition = FLOW_PALETTE[0]

describe('FlowPaletteButton', () => {
  it('muestra solo el nombre del bloque', () => {
    render(<FlowPaletteButton item={condition} onAdd={vi.fn()} />)

    expect(screen.getByText(condition.label)).toBeVisible()
    // La descripción no se ve en la paleta: solo la lee el lector de pantalla.
    expect(screen.getByText(`: ${condition.description}`)).toHaveClass('sr-only')
  })

  it('el lector de pantalla oye el nombre y para qué sirve', () => {
    render(<FlowPaletteButton item={condition} onAdd={vi.fn()} />)

    const button = screen.getByRole('button')
    expect(button).toHaveAccessibleName(expect.stringContaining(condition.label))
    expect(button).toHaveAccessibleName(expect.stringContaining(condition.description))
  })

  it('explica el bloque en un tooltip al llegar con el teclado', async () => {
    const user = userEvent.setup()
    render(<FlowPaletteButton item={condition} onAdd={vi.fn()} />)

    await user.tab()

    expect(await screen.findByRole('tooltip')).toHaveTextContent(condition.description)
  })

  it('agrega el bloque al hacer clic', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<FlowPaletteButton item={condition} onAdd={onAdd} />)

    await user.click(screen.getByRole('button'))

    expect(onAdd).toHaveBeenCalledWith(condition.type)
  })
})
