import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

const badgeVariants = cva('inline-flex items-center justify-center rounded-full', {
  variants: {
    variant: {
      /** Contador verde de no leídos, como WhatsApp. */
      unread: 'bg-wa-primary text-white font-semibold',
      neutral: 'bg-wa-field text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark font-medium',
      success:
        'bg-wa-primary/15 text-wa-primary-strong dark:bg-wa-primary/20 dark:text-wa-primary font-semibold',
      warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 font-semibold',
      danger: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300 font-semibold',
      info: 'bg-wa-accent/15 text-sky-700 dark:bg-wa-accent/20 dark:text-wa-accent font-semibold',
    },
    size: {
      /** Contador: lo más chico que sigue siendo legible. */
      sm: 'min-w-4 px-1.5 py-0.5 text-[10px] leading-4',
      /** Etiqueta de estado con ícono + texto dentro de una fila. */
      md: 'gap-1 px-2 py-0.5 text-[11px] leading-5',
    },
  },
  defaultVariants: { variant: 'neutral', size: 'sm' },
})

type Props = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>

export function Badge({ variant, size, className, ...rest }: Props) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...rest} />
}
