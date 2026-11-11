import { useId, useState } from 'react'
import type { DashboardHours } from '../types'
import { NoData } from './primitives'
import { MIN_DAYS_FOR_PATTERN, buildHoursGrid, formatAverage, personPeak, type HoursReading } from './hoursGrid'

export interface HoursReadingOption {
  key: HoursReading
  label: string
  /** Qué mide, en una línea, bajo el selector. */
  hint: string
}

// Un solo tono en degradado: la intensidad se lee sola y no compite con los
// colores de estado del resto del panel. El nivel 0 es el neutro del fondo.
const LEVEL_CLASS = [
  'bg-wa-field dark:bg-wa-field-dark',
  'bg-wa-primary/15',
  'bg-wa-primary/35',
  'bg-wa-primary/55',
  'bg-wa-primary/80',
  'bg-wa-primary-strong dark:bg-wa-primary',
]
// Muy pocos casos: borde punteado y sin relleno, para que no se lea como "0 %".
const FEW_CASES_CLASS = 'border border-dashed border-wa-muted/60 dark:border-wa-muted-dark/60'

interface Props {
  hours: DashboardHours | undefined
  days: number
  readings: HoursReadingOption[]
  /** Nombre accesible del mapa; el título visible lo pone el Panel. */
  label: string
  /** Pinta contra la franja más cargada de la persona más activa del equipo,
   *  no contra el máximo propio: para mapas de una persona, que se comparan
   *  con los de otra. */
  teamScale?: boolean
}

/**
 * Día de la semana por franja horaria, con varias lecturas sobre la misma
 * cuadrícula. Se alterna en el mismo lugar en vez de poner un mapa por
 * lectura: el ojo compara mal intensidades entre dos cuadrículas, y lo que
 * interesa ver es el hueco entre una y otra en la misma celda.
 */
export function HoursHeatmap({ hours, days, readings, label, teamScale = false }: Props) {
  // null = la primera lectura. No se copia `readings[0]` al estado: si la lista
  // cambia (del equipo a una persona), la elegida puede dejar de existir.
  const [readingKey, setReadingKey] = useState<HoursReading | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const readoutId = useId()
  const reading = readings.find(item => item.key === readingKey) ?? readings[0]

  if (!hours) return <NoData />
  if (days < MIN_DAYS_FOR_PATTERN) {
    return (
      <p className="text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
        Con {days} días cada celda tendría una sola muestra y se vería como patrón lo que es casualidad.
        Elige «Últimos 30 días» o más para ver las horas de la semana.
      </p>
    )
  }

  const sharedMax = teamScale ? personPeak(hours, reading.key) : undefined
  const grid = buildHoursGrid(hours, reading.key, sharedMax)

  return (
    <div>
      {readings.length > 1 && (
        <div role="group" aria-label="Qué mostrar en el mapa" className="mb-3 inline-flex max-w-full flex-wrap rounded-lg border border-wa-border bg-wa-app p-1 dark:border-wa-border-dark dark:bg-wa-app-dark">
          {readings.map(item => (
            <button
              key={item.key}
              type="button"
              aria-pressed={item.key === reading.key}
              onClick={() => { setReadingKey(item.key); setPicked(null) }}
              className={`min-h-9 rounded-md px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-wa-primary/60 ${
                item.key === reading.key
                  ? 'bg-white font-semibold text-wa-text shadow-sm dark:bg-wa-head-dark dark:text-wa-text-dark'
                  : 'text-wa-muted hover:text-wa-text dark:text-wa-muted-dark dark:hover:text-wa-text-dark'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <p className="mb-3 text-[11px] text-wa-muted dark:text-wa-muted-dark">{reading.hint}</p>

      {!grid.hasData ? <NoData label="Sin movimiento en el período" /> : (
        <>
          <table aria-label={`${label}: ${reading.label}`} aria-describedby={readoutId} className="w-full table-fixed border-separate border-spacing-0.5">
            <thead>
              <tr>
                <th scope="col" className="w-9"><span className="sr-only">Día</span></th>
                {grid.slots.map(slot => (
                  <th key={slot} scope="col" className="text-center text-[10px] font-normal tabular-nums text-wa-muted dark:text-wa-muted-dark">
                    {slot}<span className="sr-only"> horas</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map(row => (
                <tr key={row.weekday}>
                  <th scope="row" className="pr-1 text-left text-[11px] font-normal text-wa-muted dark:text-wa-muted-dark">{row.weekday}</th>
                  {row.cells.map((cell, slot) => (
                    <td key={slot} className="p-0">
                      <button
                        type="button"
                        title={cell.description}
                        aria-label={cell.description}
                        onClick={() => setPicked(cell.description)}
                        onMouseEnter={() => setPicked(cell.description)}
                        onFocus={() => setPicked(cell.description)}
                        className={`block h-7 w-full rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-wa-primary-strong ${
                          cell.value === null ? FEW_CASES_CLASS : LEVEL_CLASS[cell.level]
                        }`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] text-wa-muted dark:text-wa-muted-dark">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5">
                {grid.isRate ? '0 %' : 'Menos'}
                <span className="flex gap-0.5" aria-hidden="true">
                  {LEVEL_CLASS.slice(1).map(levelClass => <span key={levelClass} className={`h-3 w-3 rounded-[2px] ${levelClass}`} />)}
                </span>
                {grid.isRate ? `${Math.round(grid.max)} %` : `${formatAverage(grid.max)} por franja`}
              </span>
              {sharedMax !== undefined && <span>Misma escala para todas las personas</span>}
              {grid.isRate && (
                <span className="flex items-center gap-1.5">
                  <span className={`h-3 w-3 rounded-[2px] ${FEW_CASES_CLASS}`} aria-hidden="true" />
                  Muy pocos casos
                </span>
              )}
            </div>
            <p id={readoutId} aria-live="polite" className="font-medium text-wa-text dark:text-wa-text-dark">
              {picked ?? 'Toca o pasa el cursor por una celda'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
