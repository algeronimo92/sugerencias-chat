import { AlertTriangle, Check, Loader2, RefreshCw, Save, Search, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Skeleton } from './ui/Skeleton'

/**
 * Layout compartido por los tres catálogos (servicios, etiquetas, categorías
 * de plantillas): mismo formulario en línea, misma fila de ítem, mismo botón
 * de activar/desactivar. Cada panel solo aporta lo que de verdad cambia entre
 * ellos: los textos, el campo de nombre (y color, solo en Etiquetas) y sus
 * mutaciones — la carga, el error, la búsqueda y los estados vacíos viven
 * acá una sola vez.
 */
interface CatalogPanelProps<T> {
  icon: LucideIcon
  title: string
  description: string
  createForm: ReactNode
  items: T[]
  getId: (item: T) => number
  getName: (item: T) => string
  isLoading: boolean
  error: unknown
  onRetry: () => void
  loadErrorTitle: string
  searchPlaceholder: string
  singularNoun: string
  pluralNoun: string
  emptyTitle: string
  emptyDescription: string
  /** Contenido editable de la fila (input de nombre, metadata de creación y,
   *  en Etiquetas, el selector de color antes del nombre). */
  renderFields: (item: T) => ReactNode
  isActive: (item: T) => boolean
  hasChanges: (item: T) => boolean
  isPending: (item: T) => boolean
  onSave: (item: T) => void
  onToggle: (item: T) => void
  formError: string | null
}

/** Debajo de este tamaño la lista completa cabe de un vistazo (Miller): el
 *  buscador recién paga su costo visual cuando hay más que escanear. */
const SEARCH_THRESHOLD = 8

export function CatalogPanel<T>({
  icon: Icon,
  title,
  description,
  createForm,
  items,
  getId,
  getName,
  isLoading,
  error,
  onRetry,
  loadErrorTitle,
  searchPlaceholder,
  singularNoun,
  pluralNoun,
  emptyTitle,
  emptyDescription,
  renderFields,
  isActive,
  hasChanges,
  isPending,
  onSave,
  onToggle,
  formError,
}: CatalogPanelProps<T>) {
  const [query, setQuery] = useState('')
  const showSearch = items.length > SEARCH_THRESHOLD
  const normalizedQuery = query.trim().toLowerCase()
  const visible = useMemo(
    () => (normalizedQuery ? items.filter(item => getName(item).toLowerCase().includes(normalizedQuery)) : items),
    [items, normalizedQuery, getName],
  )

  return (
    <div>
      <div className="rounded-xl border border-wa-border bg-white p-4 sm:p-5 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-wa-text dark:text-wa-text-dark">{title}</h2>
        </div>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">{description}</p>
        <div className="mt-4">{createForm}</div>
        {formError && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{formError}</p>}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-wa-text dark:text-wa-text-dark">Listado</h3>
          <p aria-live="polite" className="mt-0.5 text-sm text-wa-muted dark:text-wa-muted-dark">
            {isLoading ? 'Cargando…' : error ? 'Listado no disponible' : normalizedQuery ? `${visible.length} de ${items.length} ${pluralNoun}` : `${items.length} ${items.length === 1 ? singularNoun : pluralNoun}`}
          </p>
        </div>
        {showSearch && (
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">{searchPlaceholder}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
            <Input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-10 w-full border-wa-border bg-white pl-9 dark:border-wa-border-dark dark:bg-wa-panel-dark"
            />
          </label>
        )}
      </div>

      {isLoading ? (
        <ul className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-3" aria-label="Cargando catálogo">
          {[0, 1, 2, 3].map(index => (
            <li key={index} className="flex flex-col gap-2 rounded-xl border border-wa-border p-3 dark:border-wa-border-dark sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-8 w-full max-w-xs" />
                <Skeleton className="h-2.5 w-32" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-7 w-20 rounded-md" />
                <Skeleton className="h-7 w-20 rounded-md" />
              </div>
            </li>
          ))}
        </ul>
      ) : error ? (
        <div role="alert" className="mt-3 flex flex-col items-start gap-3 rounded-xl border border-wa-border bg-white px-5 py-6 dark:border-wa-border-dark dark:bg-wa-panel-dark">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">{loadErrorTitle}</p>
            <p className="mt-1 max-w-lg text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
              {extractErrorMessage(error)} Prueba de nuevo; si sigue igual, avisa al equipo.
            </p>
          </div>
          <Button variant="secondary" size="sm" className="h-9" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Reintentar
          </Button>
        </div>
      ) : visible.length === 0 ? (
        normalizedQuery ? (
          <div className="mt-3 rounded-xl border border-dashed border-wa-border bg-white px-5 py-6 dark:border-wa-border-dark dark:bg-wa-panel-dark">
            <p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Sin resultados para “{query.trim()}”</p>
            <p className="mt-1 text-sm text-wa-muted dark:text-wa-muted-dark">Prueba con otro término o borra la búsqueda.</p>
            <Button variant="secondary" className="mt-3 h-10" onClick={() => setQuery('')}><X className="h-4 w-4" aria-hidden="true" />Borrar búsqueda</Button>
          </div>
        ) : (
          <div className="mt-3 flex items-start gap-3 rounded-xl border border-dashed border-wa-border bg-white px-5 py-5 dark:border-wa-border-dark dark:bg-wa-panel-dark">
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
            <div><p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">{emptyTitle}</p><p className="mt-1 text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">{emptyDescription}</p></div>
          </div>
        )
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-3">
          {visible.map(item => {
            const id = getId(item)
            const active = isActive(item)
            const changed = hasChanges(item)
            const pending = isPending(item)
            const name = getName(item)
            return (
              <li
                key={id}
                className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center ${
                  active
                    ? 'border-wa-border dark:border-wa-border-dark'
                    : 'border-dashed border-wa-border bg-wa-hover/70 dark:border-wa-border-dark dark:bg-wa-head-dark/60'
                }`}
              >
                {renderFields(item)}
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-11 sm:h-9"
                    onClick={() => onSave(item)}
                    disabled={!changed || pending}
                    aria-label={`Guardar ${name}`}
                  >
                    {pending && changed
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
                    Guardar
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-11 sm:h-9"
                    onClick={() => onToggle(item)}
                    disabled={pending}
                    aria-label={`${active ? 'Desactivar' : 'Activar'} ${name}`}
                  >
                    {pending && !changed
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    : active ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                    {active ? 'Desactivar' : 'Activar'}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

    </div>
  )
}
