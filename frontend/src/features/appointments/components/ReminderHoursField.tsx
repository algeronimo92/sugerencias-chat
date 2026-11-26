import { Checkbox } from '../../../shared/ui/Checkbox'
import { Input } from '../../../shared/ui/Input'
import type { ReminderHours } from '../types'

/** El horario por defecto al activarlo: el de atención habitual. */
const DEFAULT_HOURS: ReminderHours = { start: '09:00', end: '19:00' }

type Props = {
  value: ReminderHours | null
  disabled: boolean
  onChange: (value: ReminderHours | null) => void
}

/** Solo las citas que empiezan en este horario reciben recordatorios: un
 *  evento fuera del horario de atención no es una cita con un paciente. */
export function ReminderHoursField({ value, disabled, onChange }: Props) {
  const invalid = value !== null && value.start >= value.end
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm text-wa-text dark:text-wa-text-dark">
        <Checkbox
          checked={value !== null}
          onCheckedChange={on => onChange(on ? DEFAULT_HOURS : null)}
          disabled={disabled}
        />
        <span>
          Recordar solo las citas de un horario
          <span className="block text-xs text-wa-muted dark:text-wa-muted-dark">
            Las citas que empiezan fuera de ese horario no reciben recordatorios.
          </span>
        </span>
      </label>
      {value !== null && (
        <div className="ml-6 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-wa-muted dark:text-wa-muted-dark">De</span>
            <Input
              type="time" value={value.start} aria-label="Horario de las citas: desde" className="w-36"
              disabled={disabled} onChange={event => onChange({ ...value, start: event.target.value })}
            />
            <span className="text-sm text-wa-muted dark:text-wa-muted-dark">a</span>
            <Input
              type="time" value={value.end} aria-label="Horario de las citas: hasta" className="w-36"
              aria-invalid={invalid || undefined} aria-describedby={invalid ? 'reminder-hours-error' : undefined}
              disabled={disabled} onChange={event => onChange({ ...value, end: event.target.value })}
            />
          </div>
          {invalid && (
            <p id="reminder-hours-error" role="alert" className="text-xs text-red-500 dark:text-red-400">
              La hora de fin tiene que ser posterior a la de inicio.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
