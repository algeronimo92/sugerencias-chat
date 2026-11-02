import { Loader2 } from 'lucide-react'

interface Props {
  label?: string
  className?: string
}

/** Indicador de carga centrado, con etiqueta opcional. */
export function Spinner({ label, className = '' }: Props) {
  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-2 text-sm text-wa-muted dark:text-wa-muted-dark ${className}`}
    >
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      {label && <span>{label}</span>}
    </div>
  )
}
