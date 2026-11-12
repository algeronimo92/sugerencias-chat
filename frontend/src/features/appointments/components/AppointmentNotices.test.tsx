import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AppointmentNotice } from '../types'
import { AppointmentNotices } from './AppointmentNotices'

const base = { reason: null, delivered_at: null, read_at: null, created_at: '2026-11-12T19:41:27Z' }
const notices: AppointmentNotice[] = [
  { ...base, id: 1, audience: 'client', recipient_name: 'Zarela', status: 'sent', delivery_status: 'delivered' },
  { ...base, id: 2, audience: 'staff', recipient_name: 'Antonella', status: 'sent', delivery_status: 'read' },
  { ...base, id: 3, audience: 'staff', recipient_name: 'Admin', status: 'failed', delivery_status: null, reason: 'Meta rechazó el número' },
  { ...base, id: 4, audience: 'staff', recipient_name: 'Rosa', status: 'skipped', delivery_status: null, reason: 'Sin WhatsApp cargado en Usuarios' },
  { ...base, id: 5, audience: 'staff', recipient_name: 'Grecia', status: 'sent', delivery_status: 'sent' },
]

describe('AppointmentNotices', () => {
  it('dice a quién le llegó cada aviso y por qué no a los demás', () => {
    render(<MemoryRouter><AppointmentNotices notices={notices} leadId="lead-1" /></MemoryRouter>)

    expect(screen.getByRole('link', { name: 'Cliente · Zarela: Entregado. Ver el chat' })).toHaveAttribute('href', '/chat/lead-1')
    expect(screen.getByRole('img', { name: 'Antonella: Leído' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Admin: Falló' })).toBeInTheDocument()
    expect(screen.getByText('Meta rechazó el número')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Rosa: No enviado' })).toBeInTheDocument()
    expect(screen.getByText('Sin WhatsApp cargado en Usuarios')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Grecia: Enviado' })).toBeInTheDocument()
  })

  it('no muestra nada si la cita no generó avisos', () => {
    const { container } = render(<MemoryRouter><AppointmentNotices notices={[]} leadId={null} /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
  })
})
