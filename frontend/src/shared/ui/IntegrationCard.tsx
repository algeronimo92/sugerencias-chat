import { AlertTriangle, CheckCircle2, Circle, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from './Badge'

/** Vocabulario único de estado de una integración: el color nunca viaja solo. */
export type IntegrationState = 'connected' | 'unconfigured' | 'error' | 'syncing'

const STATES: Record<IntegrationState, { label: string; variant: 'success' | 'neutral' | 'danger' | 'info'; icon: LucideIcon; spin?: boolean }> = {
  connected: { label: 'Conectado', variant: 'success', icon: CheckCircle2 },
  unconfigured: { label: 'Sin configurar', variant: 'neutral', icon: Circle },
  error: { label: 'Con error', variant: 'danger', icon: AlertTriangle },
  syncing: { label: 'Sincronizando…', variant: 'info', icon: Loader2, spin: true },
}

export function IntegrationStatusBadge({ state, label }: { state: IntegrationState; label?: string }) {
  const meta = STATES[state]
  const Icon = meta.icon
  return (
    <Badge variant={meta.variant} size="md" aria-live="polite">
      <Icon className={`h-3 w-3 ${meta.spin ? 'animate-spin' : ''}`} aria-hidden="true" />
      {label ?? meta.label}
    </Badge>
  )
}

interface Props {
  /** Ancla (`#whatsapp`) y base de los ids accesibles. */
  id: string
  icon: LucideIcon
  title: string
  description: string
  state: IntegrationState
  stateLabel?: string
  /** Una sola acción primaria por tarjeta; el resto secundarias o ghost. */
  actions?: ReactNode
  /** Primer uso: solo la tarjeta por la que conviene empezar se resalta. */
  highlight?: boolean
  children?: ReactNode
}

/**
 * Tarjeta de una conexión con un servicio externo. Es tonta: el estado y las
 * acciones los decide quien la usa. Misma superficie que CatalogPanel para
 * que Integraciones y Catálogos se lean como la misma familia de pantallas.
 */
export function IntegrationCard({ id, icon: Icon, title, description, state, stateLabel, actions, highlight = false, children }: Props) {
  const headingId = `${id}-title`
  const border = highlight
    ? 'border-wa-primary/40'
    : state === 'unconfigured'
      ? 'border-dashed border-wa-border dark:border-wa-border-dark'
      : 'border-wa-border dark:border-wa-border-dark'
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`scroll-mt-20 rounded-xl border bg-white p-4 sm:p-5 dark:bg-wa-panel-dark ${border}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-wa-field dark:bg-wa-field-dark">
            <Icon className="h-5 w-5 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={headingId} tabIndex={-1} className="text-base font-semibold text-wa-text outline-none dark:text-wa-text-dark">{title}</h2>
              <IntegrationStatusBadge state={state} label={stateLabel} />
            </div>
            <p className="mt-0.5 text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">{description}</p>
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  )
}

/** Sección plegable dentro de una tarjeta (ajustes que se tocan una vez). */
export function IntegrationDisclosure({ id, title, open, onToggle, children }: { id: string; title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-wa-border/70 dark:border-wa-border-dark/70">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm font-medium text-wa-text outline-none hover:bg-wa-hover focus-visible:ring-2 focus-visible:ring-wa-primary/60 dark:text-wa-text-dark dark:hover:bg-wa-head-dark sm:min-h-9"
      >
        {title}
        <span aria-hidden="true" className={`text-wa-muted transition-transform dark:text-wa-muted-dark ${open ? 'rotate-180' : ''}`}>⌄</span>
      </button>
      {open && <div id={id} className="border-t border-wa-border/70 p-3 dark:border-wa-border-dark/70">{children}</div>}
    </div>
  )
}
