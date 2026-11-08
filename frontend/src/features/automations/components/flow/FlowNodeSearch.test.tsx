import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FlowNodeSearch } from './FlowNodeSearch'

const items = [
  { id: 'a', number: 1, title: 'Inicio manual (vendedor)', text: '' },
  { id: 'b', number: 12, title: 'Enviar mensaje directo', text: 'Promoción de verano' },
  { id: 'c', number: 21, title: 'Pregunta', text: '¿Agendamos?' },
]

describe('FlowNodeSearch', () => {
  it('lleva al bloque por número con Enter y limpia la búsqueda', async () => {
    const onGo = vi.fn()
    render(<FlowNodeSearch items={items} onGo={onGo} />)
    const input = screen.getByRole('combobox', { name: 'Buscar bloque por número o texto' })

    await userEvent.type(input, '#12{Enter}')
    expect(onGo).toHaveBeenCalledWith('b')
    expect(input).toHaveValue('')
  })

  it('busca por lo que dice el bloque y se elige con las flechas', async () => {
    const onGo = vi.fn()
    render(<FlowNodeSearch items={items} onGo={onGo} />)
    const input = screen.getByRole('combobox')

    await userEvent.type(input, '1')
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['#1Inicio manual (vendedor)', '#12Enviar mensaje directo'])
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onGo).toHaveBeenCalledWith('b')

    await userEvent.type(input, 'verano')
    expect(screen.getByRole('option')).toHaveTextContent('#12')
    await userEvent.type(input, 'zzz')
    expect(screen.getByText('Ningún bloque coincide.')).toBeInTheDocument()
  })
})
