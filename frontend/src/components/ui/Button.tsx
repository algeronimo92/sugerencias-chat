import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap outline-none transition-[color,background-color,border-color,box-shadow,transform] focus-visible:ring-2 focus-visible:ring-wa-primary/60 focus-visible:ring-offset-1 active:translate-y-px dark:focus-visible:ring-offset-wa-panel-dark disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-wa-primary font-semibold text-white shadow-sm hover:bg-wa-primary-strong active:bg-wa-primary-deep',
        secondary: 'border border-wa-border bg-white font-medium text-wa-text shadow-sm hover:bg-wa-hover dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark dark:hover:bg-wa-active-dark',
        ghost: 'font-medium text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark dark:hover:text-wa-text-dark',
        danger: 'bg-red-600 font-semibold text-white shadow-sm hover:bg-red-700',
      },
      size: {
        sm: 'h-7 gap-1.5 rounded-md px-2.5 text-xs',
        md: 'h-9 gap-2 rounded-lg px-4 text-sm',
        icon: 'h-9 w-9 rounded-lg',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

interface Props extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

/** Botón base del CRM con la paleta WhatsApp. */
export function Button({ asChild = false, variant, size, className, type = 'button', ...rest }: Props) {
  const Component = asChild ? Slot : 'button'
  return (
    <Component
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...rest}
    />
  )
}
