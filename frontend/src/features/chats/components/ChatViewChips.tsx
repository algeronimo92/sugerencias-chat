import { BookmarkPlus, X } from 'lucide-react'
import { useState } from 'react'
import type { ChatFilters } from '../../leads/types'
import { EMPTY_CHAT_FILTERS } from '../../leads/types'
import {
  BUILT_IN_VIEWS,
  CUSTOM_VIEWS_LIMIT,
  diffFromEmpty,
  filtersEqual,
  loadCustomViews,
  saveCustomViews,
  viewFilters,
  type ChatView,
} from '../domain/savedViews'

interface Props {
  filters: ChatFilters
  onChange: (filters: ChatFilters) => void
  /** Hay filtros avanzados cargados: se ofrece guardarlos como vista propia. */
  canSave: boolean
}

const chipClass = (active: boolean) =>
  `flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-wa-primary/50 ${
    active
      ? 'border-wa-primary/50 bg-wa-primary/10 text-wa-primary-strong dark:bg-wa-primary/15 dark:text-wa-primary'
      : 'border-wa-border text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:border-wa-border-dark dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark dark:hover:text-wa-text-dark'
  }`

/** Fila de vistas de un click sobre la lista de chats. */
export function ChatViewChips({ filters, onChange, canSave }: Props) {
  const [customViews, setCustomViews] = useState<ChatView[]>(loadCustomViews)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const views = [...BUILT_IN_VIEWS, ...customViews]
  const activeId = views.find((view) => filtersEqual(viewFilters(view), filters))?.id ?? null
  // Ya existe una vista igual (predefinida o propia): guardarla sería duplicarla.
  const showSave = canSave && !activeId && customViews.length < CUSTOM_VIEWS_LIMIT

  function toggle(view: ChatView) {
    onChange(activeId === view.id ? EMPTY_CHAT_FILTERS : viewFilters(view))
  }

  function persist(next: ChatView[]) {
    setCustomViews(next)
    saveCustomViews(next)
  }

  function handleSave(event: React.FormEvent) {
    event.preventDefault()
    const label = name.trim()
    if (!label) return
    persist([...customViews, { id: `custom-${Date.now()}`, label, filters: diffFromEmpty(filters) }])
    setName('')
    setNaming(false)
  }

  return (
    <div className="mt-2.5 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Vistas rápidas">
      {views.map((view) => (
        <span key={view.id} className={chipClass(activeId === view.id)}>
          <button type="button" onClick={() => toggle(view)} aria-pressed={activeId === view.id} className="outline-none">
            {view.label}
          </button>
          {!view.builtIn && (
            <button
              type="button"
              onClick={() => {
                if (activeId === view.id) onChange(EMPTY_CHAT_FILTERS)
                persist(customViews.filter((item) => item.id !== view.id))
              }}
              aria-label={`Quitar la vista ${view.label}`}
              title="Quitar vista"
              className="-mr-1 rounded-full p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {showSave && !naming && (
        <button type="button" onClick={() => setNaming(true)} className={chipClass(false)} title="Guardar los filtros actuales como vista">
          <BookmarkPlus className="h-3 w-3" /> Guardar vista
        </button>
      )}
      {showSave && naming && (
        <form onSubmit={handleSave} className="flex shrink-0 items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setNaming(false) }}
            onBlur={() => { if (!name.trim()) setNaming(false) }}
            maxLength={30}
            placeholder="Nombre de la vista"
            aria-label="Nombre de la vista"
            className="h-6 w-36 rounded-full border border-wa-primary/50 bg-white px-2.5 text-[11px] text-wa-text outline-none dark:bg-wa-head-dark dark:text-wa-text-dark"
          />
        </form>
      )}
    </div>
  )
}
