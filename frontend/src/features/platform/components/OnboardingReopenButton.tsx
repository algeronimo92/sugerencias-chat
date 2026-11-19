import { ListChecks } from 'lucide-react'
import { Tooltip } from '../../../shared/ui/Tooltip'
import { useOnboarding, useRestoreOnboarding } from '../hooks/useOnboarding'

interface Props {
  /** Solo admins: el endpoint lo exige. */
  enabled: boolean
  className: string
}

/** Ícono de la barra superior que vuelve a mostrar los primeros pasos.
 *  Aparece solo mientras la tarjeta está cerrada y queda algo pendiente: antes
 *  la "X" la escondía para siempre y no había por dónde recuperarla. */
export function OnboardingReopenButton({ enabled, className }: Props) {
  const { data } = useOnboarding(enabled)
  const { mutate: restore, isPending } = useRestoreOnboarding()

  if (!enabled || !data || !data.dismissed || data.all_done) return null

  const label = `Primeros pasos: ${data.completed} de ${data.total} listos`
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={() => restore()}
        disabled={isPending}
        aria-label={`Mostrar los primeros pasos (${data.completed} de ${data.total} listos)`}
        className={`relative ${className}`}
      >
        <ListChecks className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden="true" />
        <span
          aria-hidden
          className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-surface"
        />
      </button>
    </Tooltip>
  )
}
