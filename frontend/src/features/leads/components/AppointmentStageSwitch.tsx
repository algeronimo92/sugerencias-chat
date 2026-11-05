import { CalendarCheck } from 'lucide-react'
import { useId } from 'react'

interface Props {
  stageName: string
  checked: boolean
  /** Una etapa desactivada no es destino: no se puede marcar. */
  available: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

/**
 * "Mover aquí al agendar una cita". A lo sumo una etapa por negocio: marcar
 * esta desmarca la anterior (lo resuelve el backend). Agendar solo avanza al
 * lead en el embudo; nunca lo devuelve a una etapa anterior.
 */
export function AppointmentStageSwitch({ stageName, checked, available, disabled, onChange }: Props) {
  const id = useId()
  return (
    <div className={`inline-flex min-h-9 items-center gap-2 text-xs ${available ? 'text-wa-text dark:text-wa-text-dark' : 'text-wa-muted dark:text-wa-muted-dark'}`}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`Mover a ${stageName} al agendar una cita`}
        disabled={disabled || (!available && !checked)}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-wa-primary-strong disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-wa-primary-strong' : 'bg-wa-muted/40 dark:bg-wa-muted-dark/40'}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      <CalendarCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <label htmlFor={id}>{available ? 'Mover aquí al agendar una cita' : 'Actívala para usarla al agendar citas'}</label>
    </div>
  )
}
