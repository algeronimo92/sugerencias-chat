import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { DashboardHours } from '../types'
import { TeamHoursPanel } from './TeamHoursPanel'

const HOURS: DashboardHours = {
  slot_hours: 2,
  engagement_window_hours: 24,
  weekday_occurrences: [1, 1, 1, 1, 1, 1, 1],
  start_date: '2026-11-05',
  person_peaks: { messages: 10, flows_manual: 3, phone_messages: 4 },
  cells: [],
  people: [
    { user_id: 2, name: 'Antonella', cells: [{ weekday: 3, slot: 5, messages: 1, flows_manual: 0, phone_messages: 4 }] },
    { user_id: 1, name: 'Grecia', cells: [{ weekday: 3, slot: 5, messages: 10, flows_manual: 3, phone_messages: 0 }] },
    { user_id: 3, name: 'Zoe', cells: [] },
  ],
}

describe('TeamHoursPanel', () => {
  it('muestra a todo el equipo junto, con su total, y dice quién no hizo nada', () => {
    render(<TeamHoursPanel hours={HOURS} />)

    const people = screen.getAllByRole('listitem')
    expect(people).toHaveLength(3)
    expect(within(people[0]).getByText('Grecia')).toBeInTheDocument()
    expect(within(people[0]).getByText('10 mensajes')).toBeInTheDocument()
    expect(within(people[1]).getByText('1 mensaje')).toBeInTheDocument()
    expect(within(people[2]).getByText('Zoe')).toBeInTheDocument()
    expect(within(people[2]).getByText('Sin actividad')).toBeInTheDocument()
    expect(screen.getByRole('grid', { name: 'Grecia: Escritos en el CRM' })).toBeInTheDocument()
    expect(screen.getByText('Misma escala para todas las personas')).toBeInTheDocument()
    expect(screen.getByText(/Cada fila es un día del período/)).toBeInTheDocument()
  })

  it('cambia qué se compara y reordena a las personas', async () => {
    const user = userEvent.setup()
    render(<TeamHoursPanel hours={HOURS} />)

    await user.click(screen.getByRole('button', { name: 'Desde el celular' }))
    expect(within(screen.getAllByRole('listitem')[0]).getByText('Antonella')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Flujos a mano' }))
    const first = screen.getAllByRole('listitem')[0]
    expect(within(first).getByText('Grecia')).toBeInTheDocument()
    expect(within(first).getByText('3 flujos')).toBeInTheDocument()
  })

  it('al tocar una celda dice de quién es y qué pasó ahí', async () => {
    const user = userEvent.setup()
    render(<TeamHoursPanel hours={HOURS} />)

    const table = screen.getByRole('grid', { name: 'Grecia: Escritos en el CRM' })
    await user.click(within(table).getByTitle(/^Jue 5 nov\.?, 10–12 h: 10 mensajes escritos en el CRM$/))
    expect(screen.getByText(/^Grecia · Jue 5 nov\.?, 10–12 h: 10 mensajes escritos en el CRM$/)).toBeInTheDocument()
  })

  // Sin esto el detalle de una celda solo se podía leer con el mouse o tocando.
  it('con el teclado, cada cuadrícula es una parada y las flechas la recorren', async () => {
    const user = userEvent.setup()
    render(<TeamHoursPanel hours={HOURS} />)

    const grid = screen.getByRole('grid', { name: 'Grecia: Escritos en el CRM' })
    // Tres botones de lectura y después la primera cuadrícula.
    await user.tab()
    await user.tab()
    await user.tab()
    await user.tab()
    expect(grid).toHaveFocus()
    expect(screen.getByText(/^Grecia · Jue 5 nov\.?, 0–2 h: 0 mensajes escritos en el CRM$/)).toBeInTheDocument()

    await user.keyboard('{End}{ArrowDown}{ArrowLeft}')
    expect(screen.getByText(/^Grecia · Vie 6 nov\.?, 20–22 h: 0 mensajes escritos en el CRM$/)).toBeInTheDocument()
    const activeCell = document.getElementById(grid.getAttribute('aria-activedescendant')!)
    expect(activeCell).toHaveAttribute('title', expect.stringMatching(/^Vie 6 nov\.?, 20–22 h/))

    // No se sale de la cuadrícula por los bordes.
    await user.keyboard('{Home}{ArrowLeft}{ArrowUp}{ArrowUp}')
    expect(screen.getByText(/^Grecia · Jue 5 nov\.?, 0–2 h/)).toBeInTheDocument()
  })

  // Durante un despliegue puede contestar un backend que todavía no manda `people`.
  it('no rompe si la respuesta no trae a las personas', () => {
    render(<TeamHoursPanel hours={{ ...HOURS, people: undefined }} />)

    expect(screen.getByText('Sin personas que comparar en el período')).toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })
})
