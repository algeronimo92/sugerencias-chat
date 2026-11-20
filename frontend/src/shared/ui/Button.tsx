import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../utils/cn'

// Sin `dark:`: los tokens semánticos ya cambian con el tema (index.css).
// Sin sombra: la jerarquía la marcan el relleno y el borde (doc 18 §5.4).
const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap outline-none transition-[color,background-color,border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // accent-fill y no accent: el verde de marca con texto blanco daba
        // 3,0:1; accent-fill garantiza 4,5:1 con cualquier color de negocio.
        primary:
          'bg-accent-fill font-semibold text-on-accent hover:bg-[color-mix(in_srgb,var(--accent-fill),#000_8%)] active:bg-[color-mix(in_srgb,var(--accent-fill),#000_14%)]',
        secondary: 'border border-line-control bg-surface font-medium text-fg hover:bg-subtle active:bg-selected',
        ghost: 'font-medium text-fg-muted hover:bg-subtle hover:text-fg active:bg-selected',
        link: 'font-medium text-accent-strong underline-offset-2 hover:underline',
        danger:
          'bg-danger font-semibold text-white hover:bg-[color-mix(in_srgb,var(--danger),#000_10%)] dark:text-canvas',
        dangerGhost: 'font-medium text-danger-fg hover:bg-danger-soft',
      },
      size: {
        /** 32 px: escritorio denso (barras de herramientas, filas). */
        sm: 'h-8 gap-1.5 rounded-lg px-3 text-xs',
        /** 40 px: el de siempre. */
        md: 'h-10 gap-2 rounded-lg px-4 text-sm',
        /** 44 px: móvil y llamada principal de una pantalla. */
        lg: 'h-11 gap-2 rounded-lg px-5 text-sm',
        icon: 'h-10 w-10 rounded-lg',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

interface Props extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Muestra un spinner, bloquea el botón y lo anuncia como ocupado. */
  loading?: boolean
}

/** Botón base del CRM. Un `primary` por vista; el resto `secondary` o `ghost`. */
export function Button({ asChild = false, loading = false, variant, size, className, type = 'button', disabled, children, ...rest }: Props) {
  const Component = asChild ? Slot : 'button'
  return (
    <Component
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...rest}
    >
      {loading && !asChild ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {children}
        </>
      ) : (
        children
      )}
    </Component>
  )
}


