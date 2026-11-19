import type { ReactNode } from 'react'
import { AlertTriangle, type LucideIcon } from 'lucide-react'
import { cn } from '../utils/cn'

interface Props {
  icon?: LucideIcon
  title: string
  description?: ReactNode
  /** La salida: una acción que resuelve el vacío ("Importar contactos", "Ver todas"). */
  action?: ReactNode
  /** Para el vacío por filtro dentro de una lista: menos aire y sin icono grande. */
  compact?: boolean
  className?: string
}

/** Estado vacío unificado: ícono lineal, título, explicación y una acción de salida. */
export function EmptyState({ icon: Icon, title, description, action, compact = false, className }: Props) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-10', className)}>
      {Icon && !compact && <Icon className="mb-1 h-10 w-10 text-fg-muted" strokeWidth={1.5} aria-hidden="true" />}
      <p className={cn('font-semibold text-fg', compact ? 'text-sm' : 'text-base')}>{title}</p>
      {description && <p className="max-w-sm text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

interface ErrorStateProps {
  /** Qué pasó, en palabras de quien usa la app. */
  title: string
  /** Por qué, si se sabe, o qué puede hacer. */
  description?: ReactNode
  /** Normalmente un botón "Reintentar". */
  action?: ReactNode
  className?: string
}

/** Error que reemplaza el contenido de una vista o un panel. Se anuncia y lleva icono, no solo rojo. */
export function ErrorState({ title, description, action, className }: ErrorStateProps) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      <span className="mb-1 inline-flex h-10 w-10 items-center justify-center rounded-full bg-danger-soft text-danger-fg">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="text-base font-semibold text-fg">{title}</p>
      {description && <p className="max-w-sm text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
