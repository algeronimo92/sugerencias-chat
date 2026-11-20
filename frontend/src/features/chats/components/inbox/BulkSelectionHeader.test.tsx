import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { BulkSelectionHeader } from './BulkSelectionHeader'

function Harness({ initial, onCancel = () => {} }: { initial: string[]; onCancel?: () => void }) {
  const [selected, setSelected] = useState(new Set(initial))
  return <BulkSelectionHeader selected={selected} visibleIds={['a', 'b', 'c']} onSelectionChange={setSelected} onCancel={onCancel} />
}

describe('cabecera del modo selección de la bandeja', () => {
  it('"Seleccionar todos" marca los visibles y lo vuelve a quitar', async () => {
    render(<Harness initial={[]} />)

    expect(screen.getByText('Toca los chats para elegirlos')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos los visibles' }))
    expect(screen.getByText('3 seleccionados')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Quitar la selección' }))
    expect(screen.getByText('Toca los chats para elegirlos')).toBeInTheDocument()
  })

  it('"Cancelar" sale del modo selección', async () => {
    const onCancel = vi.fn()
    render(<Harness initial={['a']} onCancel={onCancel} />)

    expect(screen.getByText('1 seleccionado')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
