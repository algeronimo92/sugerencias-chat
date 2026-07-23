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

/** Estado vacío unificado: ícono lineal grande, título y descripción gris. */
export function EmptyState({ icon: Icon, title, description, action, className = '' }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 px-6 py-10 text-center ${className}`}>
      {Icon && <Icon className="h-10 w-10 text-wa-muted/40 dark:text-wa-muted-dark/40" strokeWidth={1.25} />}
      <p className="text-sm font-medium text-wa-muted dark:text-wa-muted-dark">{title}</p>
      {description && <p className="max-w-xs text-xs text-wa-muted/80 dark:text-wa-muted-dark/80">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
