import { ChevronDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Tooltip } from './Tooltip'

function readStored(key: string | undefined, fallback: boolean): boolean {
  if (!key) return fallback
  try {
    const stored = localStorage.getItem(key)
    return stored === null ? fallback : stored === 'true'
  } catch {
    return fallback
  }
}

/**
 * Sección plegable de un panel lateral (la ficha del lead): título en tipo
 * oración, contador opcional y una acción a la derecha, separada de la
 * siguiente por una línea en vez de una tarjeta, como el panel de contacto de
 * Manychat. Antes cada bloque era una tarjeta con borde, sombra y título en
 * mayúsculas, y la ficha se leía como una pila de cajas.
 *
 * Con `storageKey` el plegado se recuerda en este equipo; es comodidad, sin
 * almacenamiento vale para la sesión.
 */
export function PanelSection({ title, count, action, defaultOpen = true, storageKey, children }: {
  title: string
  count?: number
  /** Botón de la sección (editar, agregar). Va fuera del botón de plegar. */
  action?: ReactNode
  defaultOpen?: boolean
  storageKey?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => readStored(storageKey, defaultOpen))
  const contentId = useId()

  function toggle() {
    setOpen((current) => {
      const next = !current
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, String(next))
        } catch {
          // Sin almacenamiento el cambio vale para esta sesión.
        }
      }
      return next
    })
  }

  return (
    <section aria-label={title} className="border-b border-line last:border-b-0">
      <div className="flex min-h-11 items-center gap-1 pr-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 text-left text-sm font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown className={`h-4 w-4 shrink-0 text-fg-muted transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
          <span className="truncate">{title}</span>
          {count != null && count > 0 && <span className="text-xs font-normal tabular-nums text-fg-muted">{count}</span>}
        </button>
        {action}
      </div>
      <div id={contentId} hidden={!open} className="px-1 pb-4">
        {children}
      </div>
    </section>
  )
}

/** Botón de icono para la acción de una sección (editar, agregar), con su
 *  nombre en el Tooltip de la app. */
export function PanelSectionAction({ label, onClick, expanded, children }: {
  label: string
  onClick: () => void
  /** Si abre un formulario dentro de la sección. */
  expanded?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-expanded={expanded}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted outline-none transition-colors hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring [&>svg]:h-4 [&>svg]:w-4"
      >
        {children}
      </button>
    </Tooltip>
  )
}
