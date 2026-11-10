import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ServiceChecklist } from './ServiceChecklist'

const SERVICES = [
  { id: 1, name: 'Botox - 1 Zona' },
  { id: 2, name: 'Botox - 2 Zonas' },
  { id: 3, name: 'Botox - 3 Zonas' },
  { id: 4, name: 'Hollywood Peel - Rostro' },
  { id: 5, name: 'Amber Glow' },
  { id: 6, name: 'Borrado de Cejas' },
  { id: 7, name: 'Depilación Láser - Bozo' },
  { id: 8, name: 'Depilación Láser - Axilas' },
  { id: 9, name: 'HIFU 12D - Rostro' },
]

describe('ServiceChecklist', () => {
  it('agrupa por tratamiento y la casilla del grupo marca todas sus zonas', async () => {
    const onChange = vi.fn()
    render(<ServiceChecklist services={SERVICES} selected={[1]} onChange={onChange} />)

    expect(screen.getByText('1 de 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Botox: todas las zonas' }))
    expect(onChange).toHaveBeenCalledWith([1, 2, 3])
  })

  it('desmarcar el grupo quita solo sus zonas', async () => {
    const onChange = vi.fn()
    render(<ServiceChecklist services={SERVICES} selected={[1, 2, 3, 5]} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Botox: todas las zonas' }))
    expect(onChange).toHaveBeenCalledWith([5])
  })

  it('con más de 8 servicios hay buscador, sin tildes ni mayúsculas', async () => {
    render(<ServiceChecklist services={SERVICES} selected={[]} onChange={() => {}} />)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar servicio' }), 'depilacion')
    expect(screen.getAllByRole('checkbox')).toHaveLength(3) // grupo + Bozo + Axilas
    expect(screen.queryByText('Amber Glow')).toBeNull()
  })

  it('el aviso nombra los marcados', () => {
    render(<ServiceChecklist services={SERVICES} selected={[1, 4]} onChange={() => {}} />)
    expect(screen.getByText('Para Botox - 1 Zona y Hollywood Peel - Rostro. El asistente lo usa primero con los leads interesados.')).toBeInTheDocument()
  })
})
