import { ChevronDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../utils/cn'
import { Skeleton } from './Skeleton'

interface SectionProps {
  title: string
  children: ReactNode
  /** Sin esto la sección no se pliega (la primera, la que siempre se usa). */
  collapsible?: boolean
  /** Clave para recordar si quedó plegada entre visitas. */
  storageKey?: string
  defaultOpen?: boolean
}

function readOpen(storageKey: string | undefined, fallback: boolean): boolean {
  if (!storageKey) return fallback
  try {
    const value = localStorage.getItem(storageKey)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

/**
 * Grupo de filtros del panel lateral (doc 18 §5.2): título de 12 px y, si se
 * pliega, un botón con `aria-expanded` que recuerda su estado.
 */
export function FilterSection({ title, children, collapsible = false, storageKey, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen))
  const listId = useId()

  function toggle() {
    const next = !open
    setOpen(next)
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, String(next))
    } catch {
      // Sin almacenamiento el cambio vale para esta sesión.
    }
  }

  return (
    <section className="border-t border-line px-2 py-2 first:border-t-0">
      {collapsible ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={listId}
          className="flex h-8 w-full items-center justify-between rounded-lg px-3 text-xs font-semibold text-fg-muted outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
        >
          {title}
          <ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', !open && '-rotate-90')} aria-hidden="true" />
        </button>
      ) : (
        <h3 className="flex h-8 items-center px-3 text-xs font-semibold text-fg-muted">{title}</h3>
      )}
      {open && <ul id={listId} className="flex flex-col gap-0.5">{children}</ul>}
    </section>
  )
}

interface ItemProps {
  label: string
  icon?: LucideIcon
  /** Punto de color en vez de icono (etapas, etiquetas). */
  color?: string
  /** `undefined`: el ítem no muestra número. `null`: todavía carga. */
  count?: number | null
  selected: boolean
  onSelect: () => void
}

/**
 * Ítem de filtro: icono o punto, etiqueta y contador a la derecha. El
 * seleccionado va en la pastilla gris de la referencia (Manychat). Mientras
 * el contador carga se ve un esqueleto, no un "0" que todavía no se sabe.
 */
export function FilterItem({ label, icon: Icon, color, count, selected, onSelect }: ItemProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
          selected ? 'bg-selected font-semibold text-fg' : 'text-fg hover:bg-subtle',
        )}
      >
        {Icon ? (
          <Icon className="h-4 w-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden="true" />
        ) : color ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count === null ? (
          <Skeleton as="span" className="h-4 w-5" />
        ) : count !== undefined ? (
          <span className="text-xs font-medium tabular-nums text-fg-muted">{count}</span>
        ) : null}
      </button>
    </li>
  )
}
