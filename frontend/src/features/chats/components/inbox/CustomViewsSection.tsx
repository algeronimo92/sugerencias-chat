import { Bookmark, BookmarkPlus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { FilterSection } from '../../../../shared/ui/FilterPanel'
import { cn } from '../../../../shared/utils/cn'
import { EMPTY_CHAT_FILTERS, type ChatFilters } from '../../../leads/types'
import {
  BUILT_IN_VIEWS,
  CUSTOM_VIEWS_LIMIT,
  diffFromEmpty,
  filtersEqual,
  loadCustomViews,
  saveCustomViews,
  viewFilters,
  type ChatView,
} from '../../domain/savedViews'

interface Props {
  filters: ChatFilters
  onChange: (filters: ChatFilters) => void
}

/**
 * "Mis vistas" en el panel de bandejas: las combinaciones de filtros que la
 * vendedora guardó, y el botón para guardar la actual. Antes vivían en los
 * chips de arriba de la lista, que en escritorio repetían el panel.
 * Siguen guardadas en este navegador; pasarlas al servidor es la decisión 9
 * del doc 18 (PR aparte).
 */
export function CustomViewsSection({ filters, onChange }: Props) {
  const [views, setViews] = useState<ChatView[]>(loadCustomViews)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const hasFilters = !filtersEqual(filters, EMPTY_CHAT_FILTERS)
  const alreadySaved = [...BUILT_IN_VIEWS, ...views].some((view) => filtersEqual(viewFilters(view), filters))
  const canSave = hasFilters && !alreadySaved && views.length < CUSTOM_VIEWS_LIMIT

  function persist(next: ChatView[]) {
    setViews(next)
    saveCustomViews(next)
  }

  function save(event: FormEvent) {
    event.preventDefault()
    const label = name.trim()
    if (!label) return
    persist([...views, { id: `custom-${Date.now()}`, label, filters: diffFromEmpty(filters) }])
    setName('')
    setNaming(false)
  }

  if (views.length === 0 && !canSave) return null

  return (
    <FilterSection title="Mis vistas" collapsible storageKey="inbox-section-custom-views">
      {views.map((view) => {
        const selected = filtersEqual(viewFilters(view), filters)
        return (
          <li key={view.id} className="group relative">
            <button
              type="button"
              onClick={() => onChange(selected ? EMPTY_CHAT_FILTERS : viewFilters(view))}
              aria-pressed={selected}
              className={cn(
                'flex h-10 w-full items-center gap-3 rounded-lg pl-3 pr-10 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'bg-selected font-semibold text-fg' : 'text-fg hover:bg-subtle',
              )}
            >
              <Bookmark className="h-4 w-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{view.label}</span>
            </button>
            {/* Siempre visible al enfocarlo y en táctil no hay hover: se ve
                tenue y toma color al pasar o enfocar. */}
            <button
              type="button"
              onClick={() => {
                if (selected) onChange(EMPTY_CHAT_FILTERS)
                persist(views.filter((item) => item.id !== view.id))
              }}
              aria-label={`Quitar la vista ${view.label}`}
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-fg-muted opacity-60 outline-none transition-opacity hover:bg-selected hover:text-fg hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        )
      })}
      {canSave && (
        <li>
          {naming ? (
            <form onSubmit={save} className="px-1 py-1">
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') setNaming(false) }}
                onBlur={() => { if (!name.trim()) setNaming(false) }}
                maxLength={30}
                placeholder="Nombre de la vista"
                aria-label="Nombre de la vista"
                className="h-9 w-full rounded-lg border border-line-control bg-surface px-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent-strong focus:ring-2 focus:ring-ring/25"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setNaming(true)}
              className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-accent-strong outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BookmarkPlus className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              Guardar vista actual
            </button>
          )}
        </li>
      )}
    </FilterSection>
  )
}
