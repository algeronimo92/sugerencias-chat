import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '../utils/cn'

// Nada por debajo de 12 px: antes los contadores iban a 10 px y las
// etiquetas a 11 (doc 18 §3.2). Los tonos usan los semánticos, que ya
// cambian con el tema, así que no hay `dark:`.
const badgeVariants = cva('inline-flex items-center justify-center whitespace-nowrap text-xs tabular-nums', {
  variants: {
    variant: {
      /** Contador de no leídos: el mismo en la barra lateral, la inferior y la lista. */
      unread: 'bg-accent-fill text-on-accent font-semibold',
      neutral: 'bg-subtle text-fg font-medium',
      accent: 'bg-accent-soft text-accent-deep font-medium',
      success: 'bg-success-soft text-success-fg font-medium',
      warning: 'bg-warning-soft text-warning-fg font-medium',
      danger: 'bg-danger-soft text-danger-fg font-medium',
      info: 'bg-info-soft text-info-fg font-medium',
    },
    size: {
      /** Contador: número suelto en una pastilla redonda. */
      sm: 'h-5 min-w-5 rounded-full px-1.5 leading-none',
      /** Etiqueta de estado con ícono + texto dentro de una fila. */
      md: 'h-6 gap-1 rounded-md px-2',
    },
  },
  defaultVariants: { variant: 'neutral', size: 'sm' },
})

type Props = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>

export function Badge({ variant, size, className, ...rest }: Props) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...rest} />
}

interface CounterProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  value: number
  /** `accent` para lo que pide atención (no leídos); `neutral` para totales. */
  tone?: 'accent' | 'neutral'
}

/** Número en una pastilla. A partir de 100 muestra "99+" y el total va en el nombre accesible. */
export function Counter({ value, tone = 'accent', className, ...rest }: CounterProps) {
  const shown = value > 99 ? '99+' : String(value)
  return (
    <Badge
      variant={tone === 'accent' ? 'unread' : 'neutral'}
      size="sm"
      className={className}
      aria-label={value > 99 ? String(value) : undefined}
      {...rest}
    >
      {shown}
    </Badge>
  )
}

interface DotProps {
  /** Lo que significa el punto, para lectores de pantalla ("no leído"). */
  label: string
  className?: string
}

/** Punto de 8 px del color de acento; el significado va en texto oculto. */
export function Dot({ label, className }: DotProps) {
  return (
    <span className={cn('inline-flex h-2 w-2 shrink-0 rounded-full bg-accent', className)}>
      <span className="sr-only">{label}</span>
    </span>
  )
}
