import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { DashboardHours } from '../types'
import { HoursHeatmap, type HoursReadingOption } from './HoursHeatmap'

const READINGS: HoursReadingOption[] = [
  { key: 'conversations', label: 'Cuántas llegan', hint: 'Conversaciones nuevas.' },
  { key: 'engaged', label: 'Siguieron conversando', hint: 'Porcentaje que volvió a escribir.' },
]

const HOURS: DashboardHours = {
  slot_hours: 2,
  engagement_window_hours: 24,
  weekday_occurrences: [5, 5, 4, 4, 4, 4, 4],
  cells: [{ weekday: 0, slot: 10, conversations: 10, settled: 10, engaged: 6, flows_manual: 0, flows_automatic: 0 }],
}

describe('HoursHeatmap', () => {
  it('cambia de lectura sobre la misma cuadrícula y dice el dato de la celda', async () => {
    const user = userEvent.setup()
    render(<HoursHeatmap hours={HOURS} days={30} readings={READINGS} label="Horas de más movimiento" />)

    expect(screen.getByRole('table', { name: 'Horas de más movimiento: Cuántas llegan' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Lun 20–22 h: 2 conversaciones nuevas en promedio' }))
    expect(screen.getByText('Lun 20–22 h: 2 conversaciones nuevas en promedio')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Siguieron conversando' }))
    expect(screen.getByRole('button', { name: 'Siguieron conversando' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Lun 20–22 h: 60 % siguió conversando' })).toBeInTheDocument()
    expect(screen.getByText('Muy pocos casos')).toBeInTheDocument()
  })

  // Con una semana cada celda es una sola muestra: se vería patrón donde hay azar.
  it('con menos de cuatro semanas avisa en vez de dibujar el mapa', () => {
    render(<HoursHeatmap hours={HOURS} days={7} readings={READINGS} label="Horas de más movimiento" />)

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText(/Elige «Últimos 30 días» o más/)).toBeInTheDocument()
  })

  it('no rompe si la respuesta no trae el bloque de horas', () => {
    render(<HoursHeatmap hours={undefined} days={30} readings={READINGS} label="Horas de más movimiento" />)

    expect(screen.getByText('Sin datos todavía')).toBeInTheDocument()
  })
})
