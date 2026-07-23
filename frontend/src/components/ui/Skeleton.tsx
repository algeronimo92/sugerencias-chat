interface Props {
  className?: string
}

/** Bloque gris pulsante para estados de carga con estructura conocida. */
export function Skeleton({ className = '' }: Props) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-wa-field dark:bg-wa-field-dark ${className}`}
    />
  )
}
