import type { HTMLAttributes } from 'react'

interface Props extends HTMLAttributes<HTMLDivElement> {
  /** `flat` quita la sombra para tarjetas secundarias/discretas. */
  flat?: boolean
}

/** Superficie base: blanco / panel oscuro WhatsApp, borde sutil. */
export function Card({ flat = false, className = '', ...rest }: Props) {
  return (
    <div
      className={`rounded-xl border border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-head-dark ${flat ? '' : 'shadow-sm'} ${className}`}
      {...rest}
    />
  )
}
