import { Search } from 'lucide-react'
import { useId, useState } from 'react'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { labelClass } from '../../../shared/ui/Input'
import { groupByFamily, normalizeSearch, type ServiceLike } from '../domain/serviceFamilies'

/**
 * A qué servicios pertenece un documento de conocimiento. Antes era un
 * selector de uno solo y una ficha que servía para "Botox - 1 Zona", "2 Zonas"
 * y "3 Zonas" había que cargarla tres veces (2026-11-09). Sin ninguno marcado
 * sirve para todos los servicios. Los servicios inactivos solo se muestran si
 * el documento ya los tenía, para poder quitarlos.
 *
 * Con 62 servicios del ERP la lista plana no servía: 6 visibles, sin
 * buscador, 62 tabulaciones. Ahora se busca por nombre y se agrupa por
 * tratamiento, con una casilla por grupo que marca todas sus zonas.
 */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

function ServiceRow({ service, checked, onToggle, nested = false }: { service: ServiceLike; checked: boolean; onToggle: (checked: boolean) => void; nested?: boolean }) {
  return (
    <li>
      <label className={`flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-1.5 text-sm text-wa-text hover:bg-wa-hover dark:text-wa-text-dark dark:hover:bg-wa-head-dark ${nested ? 'pl-7' : 'pl-1.5'}`}>
        <Checkbox checked={checked} onChange={event => onToggle(event.target.checked)} />
        <span className="min-w-0 truncate">{service.name}{service.is_active === false ? ' (inactivo)' : ''}</span>
      </label>
    </li>
  )
}

export function ServiceChecklist({ services, selected, onChange, label = 'Servicios' }: {
  services: ServiceLike[]
  selected: number[]
  onChange: (ids: number[]) => void
  label?: string
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const chosen = new Set(selected)
  const shown = services.filter(service => service.is_active !== false || chosen.has(service.id))
  // Con muchos servicios los marcados quedan fuera de la vista de la lista:
  // el aviso los nombra para verlos de un vistazo.
  const chosenNames = shown.filter(service => chosen.has(service.id)).map(service => service.name)
  const needle = normalizeSearch(query)
  const groups = groupByFamily(needle ? shown.filter(service => normalizeSearch(service.name).includes(needle)) : shown)

  function setMany(ids: number[], checked: boolean) {
    const removing = new Set(ids)
    onChange(checked ? [...selected, ...ids.filter(item => !chosen.has(item))] : selected.filter(item => !removing.has(item)))
  }

  return (
    <fieldset aria-describedby={`${id}-hint`}>
      <legend className={labelClass}>{label}</legend>
      <p id={`${id}-hint`} className="mb-2 text-xs text-wa-muted dark:text-wa-muted-dark">
        {selected.length === 0
          ? 'Sin marcar ninguno, sirve para todos los servicios.'
          : `Para ${listNames(chosenNames)}. El asistente lo usa primero con los leads interesados.`}
      </p>
      {services.length === 0
        ? <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Todavía no hay servicios en el catálogo.</p>
        : (
          <div className="rounded-lg border border-wa-border dark:border-wa-border-dark">
            {services.length > 8 && (
              <div className="flex items-center gap-2 border-b border-wa-border px-2.5 dark:border-wa-border-dark">
                <Search className="h-3.5 w-3.5 shrink-0 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  aria-label="Buscar servicio"
                  placeholder="Buscar servicio…"
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm text-wa-text outline-none placeholder:text-wa-muted dark:text-wa-text-dark dark:placeholder:text-wa-muted-dark"
                />
              </div>
            )}
            <ul className="max-h-64 space-y-0.5 overflow-y-auto p-1.5">
              {groups.length === 0 && <li className="px-2 py-2 text-xs text-wa-muted dark:text-wa-muted-dark">Ningún servicio coincide.</li>}
              {groups.map(group => {
                if (group.services.length === 1) {
                  const [service] = group.services
                  return <ServiceRow key={service.id} service={service} checked={chosen.has(service.id)} onToggle={checked => setMany([service.id], checked)} />
                }
                const ids = group.services.map(service => service.id)
                const marked = ids.filter(item => chosen.has(item)).length
                return (
                  <li key={group.name}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md py-1.5 pl-1.5 pr-1.5 text-sm font-semibold text-wa-text hover:bg-wa-hover dark:text-wa-text-dark dark:hover:bg-wa-head-dark">
                      <Checkbox
                        checked={marked === ids.length}
                        aria-label={`${group.name}: todas las zonas`}
                        onChange={event => setMany(ids, event.target.checked)}
                      />
                      <span className="min-w-0 truncate">{group.name}</span>
                      <span className="ml-auto shrink-0 text-xs font-normal text-wa-muted dark:text-wa-muted-dark">{marked ? `${marked} de ${ids.length}` : `${ids.length} zonas`}</span>
                    </label>
                    <ul className="space-y-0.5">
                      {group.services.map(service => (
                        <ServiceRow key={service.id} service={service} nested checked={chosen.has(service.id)} onToggle={checked => setMany([service.id], checked)} />
                      ))}
                    </ul>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
    </fieldset>
  )
}
