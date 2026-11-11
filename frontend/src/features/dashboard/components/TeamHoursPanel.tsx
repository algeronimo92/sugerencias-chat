import { useId, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { DashboardHours } from '../types'
import { formatNumber } from './format'
import { LEVEL_CLASS, formatAverage } from './hoursGrid'
import { NoData } from './primitives'
import { ReadingToggle } from './ReadingToggle'
import { buildTeamHours, type PersonHours, type PersonReading } from './teamHours'

const READINGS: { key: PersonReading; label: string; hint: string; unit: [string, string] }[] = [
  {
    key: 'messages',
    label: 'Escritos en el CRM',
    hint: 'Mensajes que cada persona escribió y envió en el momento desde el CRM, en cualquier chat. No cuenta programados ni flujos.',
    unit: ['mensaje', 'mensajes'],
  },
  {
    key: 'flows_manual',
    label: 'Flujos a mano',
    hint: 'Flujos que cada persona inició desde un chat.',
    unit: ['flujo', 'flujos'],
  },
  {
    key: 'phone_messages',
    label: 'Desde el celular',
    hint: 'Mensajes que salieron desde WhatsApp sin pasar por el CRM. Llegan sin autor: se cuentan por la vendedora asignada al chat, e incluyen respuestas automáticas y difusiones de WhatsApp.',
    unit: ['mensaje', 'mensajes'],
  },
]

/**
 * Todo el equipo a la vez: una cuadrícula chica por persona, con el mismo
 * tope de color. Es la excepción a "no poner dos mapas lado a lado" de
 * HoursHeatmap: ahí se alternan lecturas distintas de lo mismo; acá la
 * pregunta es justamente comparar personas (quién atiende y a qué hora), y
 * hacerlo de a una en el selector obligaba a recordar el mapa anterior.
 */
export function TeamHoursPanel({ hours }: { hours: DashboardHours | undefined }) {
  const [readingKey, setReadingKey] = useState<PersonReading>('messages')
  // La celda que se está leyendo: la del cursor, la tocada o la que se
  // recorre con las flechas.
  const [active, setActive] = useState<{ userId: number; row: number; slot: number } | null>(null)
  const readoutId = useId()
  const gridId = useId()
  const reading = READINGS.find(item => item.key === readingKey) ?? READINGS[0]

  if (!hours?.people?.length) return <NoData label="Sin personas que comparar en el período" />

  const team = buildTeamHours(hours, reading.key)
  const activePerson = active ? team.people.find(person => person.userId === active.userId) : undefined
  const picked = active && activePerson
    ? `${activePerson.name} · ${activePerson.rows[active.row]?.cells[active.slot]?.description ?? ''}`
    : null
  const cellId = (userId: number, row: number, slot: number) => `${gridId}-${userId}-${row}-${slot}`

  function pickFromPointer(event: MouseEvent<HTMLTableElement>, person: PersonHours) {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('td[data-row]')
    if (cell) setActive({ userId: person.userId, row: Number(cell.dataset.row), slot: Number(cell.dataset.slot) })
  }

  function moveWithKeys(event: KeyboardEvent<HTMLTableElement>, person: PersonHours) {
    const current = active?.userId === person.userId ? active : { userId: person.userId, row: 0, slot: 0 }
    const lastRow = person.rows.length - 1
    const lastSlot = team.slots.length - 1
    const moves: Record<string, [number, number]> = {
      ArrowUp: [Math.max(0, current.row - 1), current.slot],
      ArrowDown: [Math.min(lastRow, current.row + 1), current.slot],
      ArrowLeft: [current.row, Math.max(0, current.slot - 1)],
      ArrowRight: [current.row, Math.min(lastSlot, current.slot + 1)],
      Home: [current.row, 0],
      End: [current.row, lastSlot],
    }
    const move = moves[event.key]
    if (!move) return
    // Sin esto las flechas además desplazan la página.
    event.preventDefault()
    setActive({ userId: person.userId, row: move[0], slot: move[1] })
  }

  return (
    <div>
      <ReadingToggle
        label="Qué comparar entre personas"
        options={READINGS}
        value={reading.key}
        onChange={(key) => { setReadingKey(key); setActive(null) }}
      />
      <p className="mb-4 text-[11px] text-wa-muted dark:text-wa-muted-dark">
        {reading.hint} {team.dated ? 'Cada fila es un día del período.' : 'En promedio por día de la semana.'}
      </p>

      <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-3" aria-describedby={readoutId}>
        {team.people.map(person => (
          <li key={person.userId} className="min-w-0">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="truncate text-xs font-semibold text-wa-text dark:text-wa-text-dark">{person.name}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-wa-muted dark:text-wa-muted-dark">
                {person.total > 0
                  ? `${formatNumber(person.total)} ${reading.unit[person.total === 1 ? 0 : 1]}`
                  : 'Sin actividad'}
              </span>
            </div>
            {/* Una cuadrícula con una sola parada de tabulador y flechas para
                recorrerla: con un botón por celda, todo el equipo serían
                cientos de paradas. El puntero y el teclado se atienden acá, en
                la tabla, y cada celda lleva su texto para el lector de pantalla. */}
            <table
              role="grid"
              tabIndex={0}
              aria-label={`${person.name}: ${reading.label}`}
              aria-activedescendant={active?.userId === person.userId ? cellId(person.userId, active.row, active.slot) : undefined}
              onFocus={() => { if (active?.userId !== person.userId) setActive({ userId: person.userId, row: 0, slot: 0 }) }}
              onKeyDown={event => moveWithKeys(event, person)}
              onClick={event => pickFromPointer(event, person)}
              onMouseOver={event => pickFromPointer(event, person)}
              className="group w-full table-fixed border-separate border-spacing-px rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-wa-primary-strong/60"
            >
              <thead>
                <tr>
                  <th scope="col" className="w-10"><span className="sr-only">Día</span></th>
                  {team.slots.map(slot => (
                    <th key={slot} scope="col" className="text-center text-[9px] font-normal tabular-nums text-wa-muted dark:text-wa-muted-dark">
                      {slot}<span className="sr-only"> horas</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {person.rows.map((row, rowIndex) => (
                  <tr key={row.label}>
                    <th scope="row" className="whitespace-nowrap pr-1 text-left text-[10px] font-normal text-wa-muted dark:text-wa-muted-dark">{row.label}</th>
                    {row.cells.map((cell, slot) => {
                      const isActive = active?.userId === person.userId && active.row === rowIndex && active.slot === slot
                      return (
                        <td
                          key={slot}
                          id={cellId(person.userId, rowIndex, slot)}
                          data-row={rowIndex}
                          data-slot={slot}
                          title={cell.description}
                          // El borde marca la celda solo al recorrer con el teclado.
                          className={`h-4 rounded-[2px] p-0 ${LEVEL_CLASS[cell.level]} ${isActive ? 'group-focus-visible:outline-2 group-focus-visible:outline-wa-text dark:group-focus-visible:outline-white' : ''}`}
                        >
                          <span className="sr-only">{cell.description}</span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] text-wa-muted dark:text-wa-muted-dark">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5">
            Menos
            <span className="flex gap-0.5" aria-hidden="true">
              {LEVEL_CLASS.slice(1).map(levelClass => <span key={levelClass} className={`h-3 w-3 rounded-[2px] ${levelClass}`} />)}
            </span>
            {formatAverage(team.max)} por franja
          </span>
          <span>Misma escala para todas las personas</span>
        </div>
        <p id={readoutId} aria-live="polite" className="font-medium text-wa-text dark:text-wa-text-dark">
          {picked ?? 'Toca una celda, pasa el cursor o recórrela con las flechas'}
        </p>
      </div>
    </div>
  )
}
