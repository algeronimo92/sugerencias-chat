import { cn } from '../../utils/cn'

interface Props {
  className?: string
  /** `span` para cuando el esqueleto vive dentro de contenido en línea
   *  (el interior de un <button>, por ejemplo), donde un <div> no es válido. */
  as?: 'div' | 'span'
}

/** Bloque gris pulsante para estados de carga con estructura conocida. */
export function Skeleton({ className = '', as: Component = 'div' }: Props) {
  return (
    <Component
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-wa-field dark:bg-wa-field-dark', className)}
    />
  )
}
