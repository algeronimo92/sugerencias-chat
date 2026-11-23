import { Check } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { Input } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useBusinessHours, useSaveBusinessHours } from '../hooks/useSettings'
import type { BusinessDayHours } from '../types'

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

/** El primer día mal cargado, en palabras: el backend también lo valida, pero
 *  avisar antes evita un viaje y dice qué fila mirar. */
function firstProblem(days: BusinessDayHours[]): string | null {
  const wrong = days.find((day) => day.open && day.start >= day.end)
  return wrong ? `El ${DAY_NAMES[wrong.weekday].toLowerCase()} la hora de cierre debe ser posterior a la de apertura.` : null
}

/**
 * Qué días atiende el negocio y de qué hora a qué hora. Lo usan las
 * automatizaciones con «solo en horario laboral»: antes era lunes a viernes de
 * 8 a 18 para todos, y un negocio que atiende los sábados los perdía.
 *
 * Tiene su propio «Guardar»: es una decisión aparte del resto de ajustes y no
 * debe viajar con un borrador viejo de la página.
 */
export function BusinessHoursCard() {
  const { data, isLoading, error } = useBusinessHours()
  const save = useSaveBusinessHours()
  // Null mientras no se toca nada: se muestra lo guardado, y un refresco del
  // dato no pisa lo que la persona está editando.
  const [draft, setDraft] = useState<BusinessDayHours[] | null>(null)
  const days = draft ?? data?.days ?? []
  const problem = firstProblem(days)

  function change(weekday: number, patch: Partial<BusinessDayHours>) {
    save.reset()
    setDraft(days.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)))
  }

  function handleSave() {
    if (!draft || problem) return
    save.mutate(draft, { onSuccess: () => setDraft(null) })
  }

  return (
    <section aria-labelledby="ajustes-horario" className="rounded-xl border border-line bg-surface p-4">
      <h2 id="ajustes-horario" className="text-sm font-semibold text-fg">Horario de atención</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Lo usan las automatizaciones que solo corren en horario laboral.
        {data && <> Las horas son de la zona {data.timezone}, que se cambia en{' '}
          <Link to="/integraciones" className="font-semibold text-accent-strong underline">Integraciones</Link>.</>}
      </p>

      {isLoading && <p className="py-4 text-sm text-fg-muted">Cargando horario…</p>}
      {error && <p role="alert" className="py-4 text-sm text-danger-fg">No se pudo cargar el horario.</p>}

      {data && (
        <>
          {!data.configured && !draft && (
            <p className="mt-3 rounded-lg bg-subtle px-3 py-2 text-sm text-fg-muted">
              Todavía no lo configuraste: se usa lunes a viernes de 08:00 a 18:00.
            </p>
          )}
          <ul className="mt-3 divide-y divide-line">
            {days.map((day) => {
              const name = DAY_NAMES[day.weekday]
              return (
                <li key={day.weekday} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                  <label className="flex w-32 shrink-0 items-center gap-2 text-sm text-fg">
                    <Checkbox checked={day.open} onCheckedChange={(open) => change(day.weekday, { open })} />
                    {name}
                  </label>
                  {day.open ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="time" value={day.start} aria-label={`${name}: desde`} className="w-36"
                        onChange={(event) => change(day.weekday, { start: event.target.value })}
                      />
                      <span className="text-sm text-fg-muted">a</span>
                      <Input
                        type="time" value={day.end} aria-label={`${name}: hasta`} className="w-36"
                        aria-invalid={day.start >= day.end || undefined}
                        onChange={(event) => change(day.weekday, { end: event.target.value })}
                      />
                    </div>
                  ) : (
                    <span className="text-sm text-fg-muted">Cerrado</span>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="mt-3 flex items-center gap-3">
            <p className="flex-1 text-sm" role={problem || save.error ? 'alert' : 'status'}>
              {problem ? (
                <span className="text-danger-fg">{problem}</span>
              ) : save.error ? (
                <span className="text-danger-fg">{extractErrorMessage(save.error)}</span>
              ) : save.isSuccess && !draft ? (
                <span className="flex items-center gap-1 text-accent-strong"><Check className="h-4 w-4" aria-hidden="true" /> Horario guardado</span>
              ) : null}
            </p>
            <Button variant="secondary" onClick={handleSave} disabled={!draft || Boolean(problem)} loading={save.isPending}>
              Guardar horario
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
