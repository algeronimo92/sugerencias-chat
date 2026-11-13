import { useId, useState } from 'react'
import type { DashboardHours } from '../types'
import { formatNumber } from './format'
import { HoursMiniGrid } from './HoursMiniGrid'
import { LEVEL_CLASS, WHATSAPP_LEVEL_CLASS, formatAverage } from './hoursGrid'
import { NoData } from './primitives'
import { ReadingToggle } from './ReadingToggle'
import { buildTeamHours, teamHeadline, type PersonReading } from './teamHours'

// Las dos lecturas son del mismo tipo: algo que una persona hizo y que quedó
// con su nombre. Lo que sale por WhatsApp no trae autor y por eso no es una
// tercera pestaña: es una fuente aparte, dentro de "Mensajes".
const READINGS: { key: PersonReading; label: string; hint: string; unit: [string, string]; none: string }[] = [
  {
    key: 'messages',
    label: 'Mensajes',
    hint: 'Mensajes que cada persona escribió y envió desde el CRM. Lo que salió por WhatsApp va aparte, abajo, porque no trae autor.',
    unit: ['mensaje', 'mensajes'],
    // No "Sin actividad": puede estar atendiendo todo por WhatsApp.
    none: 'Nada escrito en el CRM',
  },
  {
    key: 'flows_manual',
    label: 'Flujos a mano',
    hint: 'Flujos que cada persona inició desde un chat. Los que se inician solos no cuentan.',
    unit: ['flujo', 'flujos'],
    none: 'Ningún flujo iniciado',
  },
]

function Ramp({ levels }: { levels: string[] }) {
  return (
    <span className="flex gap-0.5" aria-hidden="true">
      {levels.slice(1).map(levelClass => <span key={levelClass} className={`h-3 w-3 rounded-[2px] ${levelClass}`} />)}
    </span>
  )
}

/**
 * Quién atiende y a qué hora: una cuadrícula chica por persona, con el mismo
 * tope de color, y aparte lo que salió por WhatsApp sin pasar por el CRM.
 *
 * Es la excepción a "no poner dos mapas lado a lado" de HoursHeatmap: ahí se
 * alternan lecturas distintas de lo mismo; acá la pregunta es justamente
 * comparar personas, y hacerlo de a una en el selector obligaba a recordar el
 * mapa anterior.
 */
export function TeamHoursPanel({ hours }: { hours: DashboardHours | undefined }) {
  const [readingKey, setReadingKey] = useState<PersonReading>('messages')
  const [picked, setPicked] = useState<string | null>(null)
  const readoutId = useId()
  const whatsappId = useId()
  const reading = READINGS.find(item => item.key === readingKey) ?? READINGS[0]

  if (!hours) return <NoData />

  const team = buildTeamHours(hours, reading.key)
  const whatsapp = team.whatsapp && team.whatsapp.total > 0 ? team.whatsapp : null
  if (team.people.length === 0 && !whatsapp && reading.key === 'messages') {
    return <NoData label="Nadie escribió en el CRM ni salieron mensajes por WhatsApp en el período" />
  }

  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-wa-text dark:text-wa-text-dark">{teamHeadline(team, reading.key)}</p>
      <ReadingToggle
        label="Qué comparar entre personas"
        options={READINGS}
        value={reading.key}
        onChange={(key) => { setReadingKey(key); setPicked(null) }}
      />
      <p className="mb-4 text-[11px] text-wa-muted dark:text-wa-muted-dark">
        {reading.hint} {team.dated ? 'Cada fila es un día.' : 'En promedio por día de la semana.'}
      </p>

      {team.people.length > 0 && (
        <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-3" aria-label="En el CRM, por persona" aria-describedby={readoutId}>
          {team.people.map(person => (
            <li key={person.userId} className="min-w-0">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-semibold text-wa-text dark:text-wa-text-dark">{person.name}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-wa-muted dark:text-wa-muted-dark">
                  {person.total > 0 ? `${formatNumber(person.total)} ${reading.unit[person.total === 1 ? 0 : 1]}` : reading.none}
                </span>
              </div>
              <HoursMiniGrid
                // Otra lectura es otra cuadrícula: la celda marcada no se arrastra.
                key={reading.key}
                label={`${person.name}: ${reading.label}`}
                slots={team.slots}
                rows={person.rows}
                levelClass={LEVEL_CLASS}
                onRead={description => setPicked(`${person.name} · ${description}`)}
              />
            </li>
          ))}
        </ul>
      )}

      {whatsapp && (
        <section
          aria-labelledby={whatsappId}
          aria-describedby={readoutId}
          className="mt-6 grid gap-x-8 gap-y-3 border-t border-wa-border pt-5 sm:grid-cols-2 xl:grid-cols-3 dark:border-wa-border-dark"
        >
          <div className="min-w-0">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <h3 id={whatsappId} className="flex min-w-0 items-baseline gap-2 text-xs font-semibold text-wa-text dark:text-wa-text-dark">
                <span className="truncate">WhatsApp, fuera del CRM</span>
                <span className="shrink-0 rounded-full border border-wa-border px-1.5 py-px text-[10px] font-medium text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
                  Sin autor
                </span>
              </h3>
              <span className="shrink-0 text-[11px] tabular-nums text-wa-muted dark:text-wa-muted-dark">
                {formatNumber(whatsapp.total)} {whatsapp.total === 1 ? 'mensaje' : 'mensajes'}
              </span>
            </div>
            <HoursMiniGrid
              label="WhatsApp, fuera del CRM: mensajes sin autor"
              slots={team.slots}
              rows={whatsapp.rows}
              levelClass={WHATSAPP_LEVEL_CLASS}
              onRead={description => setPicked(`WhatsApp, fuera del CRM · ${description}`)}
            />
          </div>
        </section>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] text-wa-muted dark:text-wa-muted-dark">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {team.people.length > 0 && (
            <span className="flex items-center gap-1.5">
              <Ramp levels={LEVEL_CLASS} />
              Personas: hasta {formatAverage(team.max)} por franja, misma escala para todas
            </span>
          )}
          {whatsapp && (
            <span className="flex items-center gap-1.5">
              <Ramp levels={WHATSAPP_LEVEL_CLASS} />
              WhatsApp: hasta {formatAverage(whatsapp.max)} por franja, escala propia
            </span>
          )}
        </div>
        <p id={readoutId} aria-live="polite" className="font-medium text-wa-text dark:text-wa-text-dark">
          {picked ?? 'Toca una celda, pasa el cursor o recórrela con las flechas'}
        </p>
      </div>
    </div>
  )
}
