import { useId, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { HoursRow } from './teamHours'

interface Props {
  /** Nombre accesible de la cuadrícula: de quién es y qué cuenta. */
  label: string
  slots: string[]
  rows: HoursRow[]
  /** Clase de fondo por nivel de intensidad (0 = sin movimiento). */
  levelClass: string[]
  /** La celda que se está leyendo, con el cursor, el dedo o las flechas. */
  onRead: (description: string) => void
}

/**
 * Una cuadrícula chica de día por franja horaria, para poner varias juntas.
 *
 * Tiene una sola parada de tabulador y se recorre con las flechas: con un
 * botón por celda, todo el equipo serían cientos de paradas. El puntero y el
 * teclado se atienden en la tabla, y cada celda lleva su texto para el lector
 * de pantalla.
 */
export function HoursMiniGrid({ label, slots, rows, levelClass, onRead }: Props) {
  const gridId = useId()
  const [active, setActive] = useState({ row: 0, slot: 0 })
  const cellId = (row: number, slot: number) => `${gridId}-${row}-${slot}`

  function read(row: number, slot: number) {
    setActive({ row, slot })
    const description = rows[row]?.cells[slot]?.description
    if (description) onRead(description)
  }

  function readFromPointer(event: MouseEvent<HTMLTableElement>) {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('td[data-row]')
    if (cell) read(Number(cell.dataset.row), Number(cell.dataset.slot))
  }

  function moveWithKeys(event: KeyboardEvent<HTMLTableElement>) {
    const lastRow = rows.length - 1
    const lastSlot = slots.length - 1
    const moves: Record<string, [number, number]> = {
      ArrowUp: [Math.max(0, active.row - 1), active.slot],
      ArrowDown: [Math.min(lastRow, active.row + 1), active.slot],
      ArrowLeft: [active.row, Math.max(0, active.slot - 1)],
      ArrowRight: [active.row, Math.min(lastSlot, active.slot + 1)],
      Home: [active.row, 0],
      End: [active.row, lastSlot],
    }
    const move = moves[event.key]
    if (!move) return
    // Sin esto las flechas además desplazan la página.
    event.preventDefault()
    read(move[0], move[1])
  }

  return (
    <table
      role="grid"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={cellId(active.row, active.slot)}
      onFocus={() => read(active.row, active.slot)}
      onKeyDown={moveWithKeys}
      onClick={readFromPointer}
      onMouseOver={readFromPointer}
      className="group w-full table-fixed border-separate border-spacing-px rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-wa-primary-strong/60"
    >
      <thead>
        <tr>
          <th scope="col" className="w-10"><span className="sr-only">Día</span></th>
          {slots.map(slot => (
            <th key={slot} scope="col" className="text-center text-[9px] font-normal tabular-nums text-wa-muted dark:text-wa-muted-dark">
              {slot}<span className="sr-only"> horas</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={row.label}>
            <th scope="row" className="whitespace-nowrap pr-1 text-left text-[10px] font-normal text-wa-muted dark:text-wa-muted-dark">{row.label}</th>
            {row.cells.map((cell, slot) => (
              <td
                key={slot}
                id={cellId(rowIndex, slot)}
                data-row={rowIndex}
                data-slot={slot}
                title={cell.description}
                // El borde marca la celda solo al recorrer con el teclado.
                className={`h-4 rounded-[2px] p-0 ${levelClass[cell.level]} ${
                  active.row === rowIndex && active.slot === slot
                    ? 'group-focus-visible:outline-2 group-focus-visible:outline-wa-text dark:group-focus-visible:outline-white'
                    : ''
                }`}
              >
                <span className="sr-only">{cell.description}</span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
