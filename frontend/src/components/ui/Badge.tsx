import type { HTMLAttributes } from 'react'

type Variant = 'unread' | 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const VARIANT_CLASS: Record<Variant, string> = {
  /** Contador verde de no leídos, como WhatsApp. */
  unread: 'bg-wa-primary text-white font-semibold',
  neutral:
    'bg-wa-field text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark font-medium',
  success:
    'bg-wa-primary/15 text-wa-primary-strong dark:bg-wa-primary/20 dark:text-wa-primary font-semibold',
  warning:
    'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 font-semibold',
  danger: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300 font-semibold',
  info: 'bg-wa-accent/15 text-sky-700 dark:bg-wa-accent/20 dark:text-wa-accent font-semibold',
}

interface Props extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant
}

export function Badge({ variant = 'neutral', className = '', ...rest }: Props) {
  return (
    <span
      className={`inline-flex min-w-4 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] leading-4 ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    />
  )
}
