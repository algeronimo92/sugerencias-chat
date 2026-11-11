import { useId, useState } from 'react'
import type { DashboardHours } from '../types'
import { formatNumber } from './format'
import { LEVEL_CLASS, formatAverage } from './hoursGrid'
import { NoData } from './primitives'
import { ReadingToggle } from './ReadingToggle'
import { buildTeamHours, type PersonReading } from './teamHours'

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
  const [picked, setPicked] = useState<string | null>(null)
  const readoutId = useId()
  const reading = READINGS.find(item => item.key === readingKey) ?? READINGS[0]

  if (!hours?.people?.length) return <NoData label="Sin personas que comparar en el período" />

  const team = buildTeamHours(hours, reading.key)

  return (
    <div>
      <ReadingToggle
        label="Qué comparar entre personas"
        options={READINGS}
        value={reading.key}
        onChange={(key) => { setReadingKey(key); setPicked(null) }}
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
            <table aria-label={`${person.name}: ${reading.label}`} className="w-full table-fixed border-separate border-spacing-px">
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
                {person.rows.map(row => (
                  <tr key={row.label}>
                    <th scope="row" className="whitespace-nowrap pr-1 text-left text-[10px] font-normal text-wa-muted dark:text-wa-muted-dark">{row.label}</th>
                    {row.cells.map((cell, slot) => (
                      // Celdas y no botones: con todo el equipo serían cientos
                      // de paradas de tabulador. El valor va como texto para el
                      // lector de pantalla y se lee al pasar el cursor o tocar.
                      <td
                        key={slot}
                        title={cell.description}
                        onMouseEnter={() => setPicked(`${person.name} · ${cell.description}`)}
                        onClick={() => setPicked(`${person.name} · ${cell.description}`)}
                        className={`h-4 rounded-[2px] p-0 ${LEVEL_CLASS[cell.level]}`}
                      >
                        <span className="sr-only">{cell.description}</span>
                      </td>
                    ))}
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
          {picked ?? 'Toca o pasa el cursor por una celda'}
        </p>
      </div>
    </div>
  )
}
