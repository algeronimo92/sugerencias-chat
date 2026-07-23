import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'icon'

const VARIANT_CLASS: Record<Variant, string> = {
  primary:
    'bg-wa-primary text-white hover:bg-wa-primary-strong active:bg-wa-primary-deep font-semibold shadow-sm',
  secondary:
    'border border-wa-border bg-white text-wa-text hover:bg-wa-hover dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark dark:hover:bg-wa-active-dark font-medium',
  ghost:
    'text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark dark:hover:text-wa-text-dark font-medium',
  danger:
    'bg-red-600 text-white hover:bg-red-700 font-semibold shadow-sm',
}

const SIZE_CLASS: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-4 text-sm gap-2 rounded-lg',
  // Solo-icono: siempre con aria-label y title.
  icon: 'h-9 w-9 rounded-lg',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

/** Botón base del CRM con la paleta WhatsApp. */
export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-wa-primary/60 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-wa-panel-dark disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`}
      {...rest}
    />
  )
}
