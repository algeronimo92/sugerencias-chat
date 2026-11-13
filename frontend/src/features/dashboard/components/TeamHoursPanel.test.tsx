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
  person_peaks: { messages: 10, flows_manual: 3 },
  cells: [{ weekday: 3, slot: 5, phone_messages: 200, conversations: 0, settled: 0, engaged: 0, flows_manual: 0, flows_automatic: 0, messages: 0 }],
  people: [
    { user_id: 2, name: 'Antonella', cells: [{ weekday: 3, slot: 5, messages: 1, flows_manual: 0 }] },
    { user_id: 1, name: 'Grecia', cells: [{ weekday: 3, slot: 5, messages: 10, flows_manual: 3 }] },
    { user_id: 3, name: 'Zoe', cells: [] },
  ],
}

describe('TeamHoursPanel', () => {
  it('muestra a todo el equipo junto, con su total, sin llamar "sin actividad" a quien atiende por WhatsApp', () => {
    render(<TeamHoursPanel hours={HOURS} />)

    const people = within(screen.getByRole('list', { name: 'En el CRM, por persona' })).getAllByRole('listitem')
    expect(people).toHaveLength(3)
    expect(within(people[0]).getByText('Grecia')).toBeInTheDocument()
    expect(within(people[0]).getByText('10 mensajes')).toBeInTheDocument()
    expect(within(people[1]).getByText('1 mensaje')).toBeInTheDocument()
    expect(within(people[2]).getByText('Zoe')).toBeInTheDocument()
    expect(within(people[2]).getByText('Nada escrito en el CRM')).toBeInTheDocument()
    expect(screen.getByRole('grid', { name: 'Grecia: Mensajes' })).toBeInTheDocument()
    expect(screen.getByText(/Cada fila es un día/)).toBeInTheDocument()
  })

  // Repartido por vendedora parecía un dato de personas y no lo era.
  it('lo de WhatsApp va aparte, como una fuente sin autor y con su propia escala', () => {
    render(<TeamHoursPanel hours={HOURS} />)

    expect(screen.getByText('200 mensajes salieron por WhatsApp fuera del CRM, sin autor. 11 se escribieron en el CRM: Grecia 10, Antonella 1.')).toBeInTheDocument()
    const source = screen.getByRole('region', { name: /WhatsApp, fuera del CRM/ })
    expect(within(source).getByText('Sin autor')).toBeInTheDocument()
    expect(within(source).getByText('200 mensajes')).toBeInTheDocument()
    // No está entre las personas.
    expect(within(screen.getByRole('list', { name: 'En el CRM, por persona' })).queryByText(/WhatsApp/)).not.toBeInTheDocument()
    expect(screen.getByText('Personas: hasta 10 por franja, misma escala para todas')).toBeInTheDocument()
    expect(screen.getByText('WhatsApp: hasta 200 por franja, escala propia')).toBeInTheDocument()
  })

  it('al comparar flujos solo quedan las personas', async () => {
    const user = userEvent.setup()
    render(<TeamHoursPanel hours={HOURS} />)

    // Dos pestañas del mismo tipo: lo que hizo alguien y quedó con su nombre.
    expect(screen.getAllByRole('button', { pressed: undefined }).filter(button => button.hasAttribute('aria-pressed'))).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Flujos a mano' }))

    expect(screen.getByText('3 flujos iniciados a mano: Grecia 3.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /WhatsApp/ })).not.toBeInTheDocument()
    const people = within(screen.getByRole('list', { name: 'En el CRM, por persona' })).getAllByRole('listitem')
    expect(within(people[0]).getByText('3 flujos')).toBeInTheDocument()
    expect(within(people[1]).getByText('Ningún flujo iniciado')).toBeInTheDocument()
  })

  it('al tocar una celda dice de quién es y qué pasó ahí', async () => {
    const user = userEvent.setup()
    render(<TeamHoursPanel hours={HOURS} />)

    await user.click(within(screen.getByRole('grid', { name: 'Grecia: Mensajes' })).getByTitle(/^Jue 5 nov\.?, 10–12 h: 10 mensajes escritos en el CRM$/))
    expect(screen.getByText(/^Grecia · Jue 5 nov\.?, 10–12 h: 10 mensajes escritos en el CRM$/)).toBeInTheDocument()

    await user.click(within(screen.getByRole('grid', { name: /WhatsApp, fuera del CRM/ })).getByTitle(/10–12 h: 200 mensajes, sin autor$/))
    expect(screen.getByText(/^WhatsApp, fuera del CRM · Jue 5 nov\.?, 10–12 h: 200 mensajes, sin autor$/)).toBeInTheDocument()
  })

  // Sin esto el detalle de una celda solo se podía leer con el mouse o tocando.
  it('con el teclado, cada cuadrícula es una parada y las flechas la recorren', async () => {
    const user = userEvent.setup()
    render(<TeamHoursPanel hours={HOURS} />)

    const grid = screen.getByRole('grid', { name: 'Grecia: Mensajes' })
    // Dos botones de lectura y después la primera cuadrícula.
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
  it('si no hay personas ni mensajes por WhatsApp, lo dice', () => {
    render(<TeamHoursPanel hours={{ ...HOURS, people: undefined, cells: [] }} />)

    expect(screen.getByText('Nadie escribió en el CRM ni salieron mensajes por WhatsApp en el período')).toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })
})
