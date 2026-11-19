import { Search } from 'lucide-react'
import { Input, Select } from '../../../shared/ui/Input'
import { ORIGIN_LABELS } from '../domain/selection'
import { useContactTags } from '../hooks/useContacts'
import type { ContactFilters, ContactOrigin } from '../types'

// Sin borde: el fondo de campo ya los separa del panel.
const filterClass = 'h-10'

interface Props {
  filters: ContactFilters
  onChange: (values: Partial<ContactFilters>) => void
}

export function ContactsFilterBar({ filters, onChange }: Props) {
  const { data: tags = [] } = useContactTags()
  return (
    <section aria-label="Filtros de contactos" className="mt-4 grid gap-2 rounded-xl border border-wa-border bg-white p-3 sm:mt-6 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr] dark:border-wa-border-dark dark:bg-wa-panel-dark">
      <span className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
        <Input type="search" value={filters.search} onChange={event => onChange({ search: event.target.value })} placeholder="Nombre, número o correo" aria-label="Buscar contacto" className={`${filterClass} pl-9`} />
      </span>
      <Select value={filters.origen} onChange={event => onChange({ origen: event.target.value as ContactOrigin | '' })} aria-label="Origen" className={filterClass}>
        <option value="">Cualquier origen</option>
        {(Object.keys(ORIGIN_LABELS) as ContactOrigin[]).map(origin => <option key={origin} value={origin}>{ORIGIN_LABELS[origin]}</option>)}
      </Select>
      <Select value={filters.tag} onChange={event => onChange({ tag: event.target.value })} aria-label="Etiqueta" className={filterClass}>
        <option value="">Cualquier etiqueta</option>
        {tags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
      </Select>
      <Select value={filters.hasLead} onChange={event => onChange({ hasLead: event.target.value as ContactFilters['hasLead'] })} aria-label="Lead" className={filterClass}>
        <option value="">Con o sin lead</option>
        <option value="yes">Ya es lead</option>
        <option value="no">Todavía no es lead</option>
      </Select>
      <Select value={filters.consent} onChange={event => onChange({ consent: event.target.value as ContactFilters['consent'] })} aria-label="Publicidad" className={filterClass}>
        <option value="">Publicidad: todos</option>
        <option value="yes">Aceptan publicidad</option>
        <option value="no">Sin permiso</option>
      </Select>
    </section>
  )
}
