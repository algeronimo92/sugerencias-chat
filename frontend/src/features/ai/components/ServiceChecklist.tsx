import { useId } from 'react'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { labelClass } from '../../../shared/ui/Input'

interface ServiceOption { id: number; name: string; is_active?: boolean }

/**
 * A qué servicios pertenece un documento de conocimiento. Antes era un
 * selector de uno solo y una ficha que servía para "Botox - 1 Zona", "2 Zonas"
 * y "3 Zonas" había que cargarla tres veces (2026-11-09). Sin ninguno marcado
 * es conocimiento general. Los servicios inactivos solo se muestran si el
 * documento ya los tenía, para poder quitarlos.
 */
export function ServiceChecklist({ services, selected, onChange, label = 'Servicios' }: {
  services: ServiceOption[]
  selected: number[]
  onChange: (ids: number[]) => void
  label?: string
}) {
  const id = useId()
  const chosen = new Set(selected)
  const shown = services.filter(service => service.is_active !== false || chosen.has(service.id))

  function toggle(serviceId: number, checked: boolean) {
    onChange(checked ? [...selected, serviceId] : selected.filter(item => item !== serviceId))
  }

  return (
    <fieldset aria-describedby={`${id}-hint`}>
      <legend className={labelClass}>{label}</legend>
      <p id={`${id}-hint`} className="mb-2 text-xs text-wa-muted dark:text-wa-muted-dark">
        {selected.length === 0
          ? 'Sin marcar ninguno, es conocimiento general: sirve para todos los servicios.'
          : `Para ${selected.length === 1 ? '1 servicio' : `${selected.length} servicios`}. El asistente lo usa primero con los leads interesados en ellos.`}
      </p>
      {shown.length === 0
        ? <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Todavía no hay servicios en el catálogo.</p>
        : (
          <ul className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-wa-border p-2 dark:border-wa-border-dark">
            {shown.map(service => (
              <li key={service.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-wa-text hover:bg-wa-hover dark:text-wa-text-dark dark:hover:bg-wa-head-dark">
                  <Checkbox checked={chosen.has(service.id)} onChange={event => toggle(service.id, event.target.checked)} />
                  <span className="min-w-0 truncate">{service.name}{service.is_active === false ? ' (inactivo)' : ''}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
    </fieldset>
  )
}
