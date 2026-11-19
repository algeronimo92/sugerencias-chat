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
  cells: [{ weekday: 0, slot: 10, conversations: 10, settled: 10, engaged: 6, flows_manual: 0, flows_automatic: 0, messages: 0, phone_messages: 0, separations: 0 }],
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

  it('con una sola lectura no ofrece selector y dice que la hora es la del registro', () => {
    const hours: DashboardHours = { ...HOURS, cells: [{ ...HOURS.cells[0], separations: 5 }] }
    const readings: HoursReadingOption[] = [{ key: 'separations', label: 'Separaciones', hint: 'La hora en que se registró, no la de la cita.' }]
    render(<HoursHeatmap hours={hours} days={30} readings={readings} label="A qué hora se separan las citas" />)

    // Cinco separaciones en cinco lunes: una por lunes.
    expect(screen.getByRole('button', { name: 'Lun 20–22 h: 1 separación registrada en promedio' })).toBeInTheDocument()
    expect(screen.getByText('La hora en que se registró, no la de la cita.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Separaciones' })).not.toBeInTheDocument()
  })

  it('los números de las celdas se apagan y se recuerda la elección en todos los mapas', async () => {
    localStorage.removeItem('dashboard-mapa-numeros')
    const user = userEvent.setup()
    const first = render(<HoursHeatmap hours={HOURS} days={30} readings={READINGS} label="Horas de más movimiento" />)
    const cell = () => screen.getByRole('button', { name: 'Lun 20–22 h: 2 conversaciones nuevas en promedio' })

    // En pantalla ancha arrancan encendidos.
    expect(screen.getByRole('switch', { name: 'Mostrar números' })).toBeChecked()
    expect(cell()).toHaveTextContent('2')

    await user.click(screen.getByRole('switch', { name: 'Mostrar números' }))
    expect(cell()).toBeEmptyDOMElement()

    // Otro mapa, montado después, respeta lo elegido.
    first.unmount()
    render(<HoursHeatmap hours={HOURS} days={30} readings={READINGS} label="Horas de más movimiento" />)
    expect(screen.getByRole('switch', { name: 'Mostrar números' })).not.toBeChecked()
    expect(cell()).toBeEmptyDOMElement()
    localStorage.removeItem('dashboard-mapa-numeros')
  })

  it('en el mapa de una persona usa la escala del equipo y lo dice', () => {
    const hours: DashboardHours = {
      ...HOURS,
      person_peaks: { messages: 10, flows_manual: 0 },
      cells: [{ ...HOURS.cells[0], messages: 10 }],
    }
    const readings: HoursReadingOption[] = [{ key: 'messages', label: 'Mensajes escritos', hint: 'Escritos en el CRM.' }]
    render(<HoursHeatmap hours={hours} days={30} readings={readings} label="A qué hora se escribe" teamScale />)

    expect(screen.getByText(/10 por franja/)).toBeInTheDocument()
    expect(screen.getByText('Misma escala para todas las personas')).toBeInTheDocument()
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
