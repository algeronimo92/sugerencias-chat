import type { ReactNode } from 'react'
import { cn } from '../utils/cn'

interface Props {
  title: ReactNode
  /** Una línea que dice para qué es la vista. Se oculta en móvil. */
  description?: ReactNode
  /** Botones a la derecha: un `primary` como máximo, el resto `secondary`. */
  actions?: ReactNode
  /** Barra de búsqueda y filtros debajo del título. */
  toolbar?: ReactNode
  className?: string
}

/**
 * El encabezado de una página: el único `<h1>` de la vista. Antes cada
 * pantalla armaba el suyo y los títulos usaban cinco tamaños distintos
 * (doc 18 §3.3); este fija 20 px semibold para todas.
 */
export function PageHeader({ title, description, actions, toolbar, className }: Props) {
  return (
    <header className={cn('border-b border-line bg-surface px-4 pt-6 pb-4 md:px-8', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-fg">{title}</h1>
          {description && <p className="mt-1 hidden text-sm text-fg-muted md:block">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {toolbar && <div className="mt-4 flex flex-wrap items-center gap-3">{toolbar}</div>}
    </header>
  )
}
