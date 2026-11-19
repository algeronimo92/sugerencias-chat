import type { ReactNode } from 'react'
import { cn } from '../utils/cn'

interface Props {
  name: string
  /** Color de la etiqueta tal como lo eligió el negocio. */
  color: string
  size?: 'sm' | 'md'
  /** Seleccionada (en un filtro): fondo de selección y texto semibold. */
  selected?: boolean
  /** Contenido extra al final, como el botón para quitarla. */
  children?: ReactNode
  className?: string
}

/**
 * Etiqueta de un lead: fondo neutro, texto del tema y el color solo en un
 * punto (doc 18 §5.3). Antes era una pastilla rellena del color pleno con
 * texto blanco: con dos o tres por fila la lista se llenaba de manchas fuertes
 * y, con colores claros (el amarillo de "Láser"), el blanco no se leía.
 */
export function TagChip({ name, color, size = 'sm', selected = false, children, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full text-fg',
        size === 'sm' ? 'h-5 px-2 text-xs' : 'h-7 px-2.5 text-xs',
        selected ? 'bg-selected font-semibold' : 'bg-subtle font-medium',
        className,
      )}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      <span className="truncate">{name}</span>
      {children}
    </span>
  )
}
