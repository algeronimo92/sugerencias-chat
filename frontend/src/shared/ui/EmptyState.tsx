import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

interface Props {
  icon?: LucideIcon
  title: string
  description?: string
  /** CTA opcional (típicamente un <Button>). */
  action?: ReactNode
  className?: string
}

/** Estado vacío unificado: ícono lineal grande, título y descripción gris.
 *  La descripción va con el gris pleno (`wa-muted`): con opacidad quedaba en
 *  3.2:1 sobre blanco, por debajo del mínimo AA de 4.5:1 para texto normal. */
export function EmptyState({ icon: Icon, title, description, action, className = '' }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 px-6 py-10 text-center ${className}`}>
      {Icon && <Icon className="h-10 w-10 text-wa-muted/40 dark:text-wa-muted-dark/40" strokeWidth={1.25} aria-hidden="true" />}
      <p className="text-sm font-medium text-wa-text dark:text-wa-text-dark">{title}</p>
      {description && <p className="max-w-sm text-xs leading-5 text-wa-muted dark:text-wa-muted-dark">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
