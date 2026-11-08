import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SaleCard } from './SaleCard'
import type { LeadActivity } from '../../leads/types'

const base = { id: 1, actor_type: 'user', actor_name: 'Lucía', metadata: null, created_at: '2026-11-07T15:00:00Z' }

describe('SaleCard', () => {
  it('muestra la compra registrada con paquete, servicio y monto', () => {
    const activity: LeadActivity = {
      ...base, event_type: 'sale_recorded', old_value: null,
      new_value: { sale_id: 9, service: 'Hollywood Peel - Rostro', package: 'x3', sessions: 3, amount: '380.00', list_price: '400.00' },
    }
    render(<SaleCard activity={activity} />)

    expect(screen.getByText(/Compró x3 de Hollywood Peel - Rostro/)).toBeInTheDocument()
    expect(screen.getByText(/· 380/)).toBeInTheDocument()
    expect(screen.getByText(/3 sesiones · Registrada por Lucía/)).toBeInTheDocument()
  })

  it('marca la compra eliminada', () => {
    const activity: LeadActivity = {
      ...base, event_type: 'sale_deleted', new_value: null,
      old_value: { sale_id: 9, service: 'Botox', package: 'Individual', sessions: 1, amount: '500.00', list_price: '500.00' },
    }
    render(<SaleCard activity={activity} />)

    expect(screen.getByText(/Compra eliminada Individual de Botox/)).toBeInTheDocument()
    expect(screen.getByText(/1 sesión · Eliminada por Lucía/)).toBeInTheDocument()
  })
})
