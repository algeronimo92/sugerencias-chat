/**
 * Lo que ocupa una tarjeta de la biblioteca mientras su imagen o video
 * todavía bajan: el ícono del tipo pulsando sobre el fondo del marco. Así la
 * lista se reconoce por tipo antes de que llegue un byte de media y nunca
 * queda un rectángulo vacío que cambia de golpe. Con prefers-reduced-motion
 * no pulsa ni se funde (regla global en index.css).
 */
import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  /** Tamaño del ícono; por defecto 32 px (h-8). */
  className?: string
}

export function PreviewLoading({ icon: Icon, className }: Props) {
  return (
    <span
      aria-hidden="true"
      data-state="loading"
      className="absolute inset-0 flex items-center justify-center text-wa-muted motion-safe:animate-pulse dark:text-wa-muted-dark"
    >
      <Icon className={className ?? 'h-8 w-8'} strokeWidth={1.5} />
    </span>
  )
}
