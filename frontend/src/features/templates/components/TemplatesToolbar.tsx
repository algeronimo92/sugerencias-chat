import { Search } from 'lucide-react'
import { Select, pillFieldClass } from '../../../shared/ui/Input'
import { cn } from '../../../shared/utils/cn'
import type { StatusFilter, TemplateListFilters, TypeFilter } from '../domain/templateList'

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'internal', label: 'Internas' },
  { value: 'official', label: 'Oficiales' },
]

interface Props {
  filters: TemplateListFilters
  onChange: (changes: Partial<TemplateListFilters>) => void
  /** Cuántas plantillas hay de cada tipo, sin contar los filtros. */
  counts: Record<TypeFilter, number>
  /** Las categorías que tienen alguna plantilla. */
  categories: string[]
}

/** Buscador y filtros de la lista: por tipo, estado y categoría. */
export function TemplatesToolbar({ filters, onChange, counts, categories }: Props) {
  return (
    <>
      <div className="relative min-w-0 flex-[1_1_16rem] sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
        <input
          type="search"
          aria-label="Buscar plantillas"
          placeholder="Buscar por nombre, texto o atajo"
          value={filters.query}
          onChange={event => onChange({ query: event.target.value })}
          className={cn(pillFieldClass, 'h-10 pl-9')}
        />
      </div>
      <div role="group" aria-label="Filtrar por tipo" className="flex gap-1 rounded-lg bg-subtle p-1">
        {TYPE_FILTERS.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filters.type === option.value}
            onClick={() => onChange({ type: option.value })}
            className={cn(
              'h-8 rounded-md px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              filters.type === option.value ? 'bg-surface font-semibold text-fg shadow-sm' : 'font-medium text-fg-muted hover:text-fg',
            )}
          >
            {option.label} <span className="tabular-nums">· {counts[option.value]}</span>
          </button>
        ))}
      </div>
      <div className="w-full sm:w-44">
        <Select aria-label="Filtrar por estado" value={filters.status} onChange={event => onChange({ status: event.target.value as StatusFilter })}>
          <option value="any">Cualquier estado</option>
          <option value="approved">Aprobada</option>
          <option value="review">En revisión</option>
          <option value="rejected">Rechazada</option>
          <option value="inactive">Desactivada</option>
        </Select>
      </div>
      <div className="w-full sm:w-48">
        <Select aria-label="Filtrar por categoría" value={filters.category} onChange={event => onChange({ category: event.target.value })}>
          <option value="">Todas las categorías</option>
          {categories.map(category => <option key={category} value={category}>{category}</option>)}
        </Select>
      </div>
    </>
  )
}
