import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SalesTrendChart } from './SalesCharts'

const points = (start: number, days: number) =>
  Array.from({ length: days }, (_, index) => ({ date: `2026-10-${String(start + index).padStart(2, '0')}`, count: 1, revenue: 10 }))

describe('SalesTrendChart', () => {
  it('en la vista diaria avisa que la línea punteada marca los domingos', () => {
    render(<SalesTrendChart current={points(12, 7)} previous={points(5, 7)} days={7} currency="PEN" />)
    expect(screen.getByText('Domingo (cierre de semana)')).toBeInTheDocument()
  })

  it('en la vista semanal marca el inicio de cada mes en vez de los domingos', () => {
    // Cruza del 1 de octubre en adelante: la semana que contiene un día 1 lleva la línea.
    const days = Array.from({ length: 90 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10)
      return { date, count: 1, revenue: 10 }
    })
    render(<SalesTrendChart current={days} previous={days} days={90} currency="PEN" />)
    expect(screen.getByText('Inicio de mes')).toBeInTheDocument()
    expect(screen.queryByText('Domingo (cierre de semana)')).toBeNull()
  })
})
