import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../utils/cn'

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Se mantiene por compatibilidad: las tarjetas ya no llevan sombra. */
  flat?: boolean
  /** Hover y foco visibles, para tarjetas que se pueden tocar. */
  interactive?: boolean
  title?: ReactNode
  description?: ReactNode
  /** Acciones a la derecha del título. */
  actions?: ReactNode
}

/**
 * Superficie para contenido que se agrupa de verdad (un KPI, un bloque de
 * configuración). Sin sombra: separa el borde, no la elevación (doc 18 §5.7).
 * Sin título, es solo el contenedor y el padding lo pone quien la usa.
 */
export function Card({ flat: _flat, interactive = false, title, description, actions, className, children, ...rest }: Props) {
  return (
    <div
      className={cn(
        'rounded-xl border border-line bg-surface',
        interactive && 'transition-colors hover:border-line-control focus-within:ring-2 focus-within:ring-ring',
        className,
      )}
      {...rest}
    >
      {(title || actions) && (
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

interface StatCardProps {
  label: ReactNode
  value: ReactNode
  /** Variación respecto del período anterior, ya con signo e icono. */
  change?: ReactNode
  hint?: ReactNode
  className?: string
}

/** Cifra destacada: etiqueta, número grande con dígitos alineados y una pista. */
export function StatCard({ label, value, change, hint, className }: StatCardProps) {
  return (
    <Card className={cn('p-5', className)}>
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{value}</p>
      {(change || hint) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
          {change}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </Card>
  )
}
