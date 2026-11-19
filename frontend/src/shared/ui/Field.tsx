import { AlertCircle } from 'lucide-react'
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { cn } from '../utils/cn'
import { labelClass } from './Input'

interface ControlProps {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}

interface Props {
  label: ReactNode
  /** Una línea de ayuda debajo del campo. */
  hint?: ReactNode
  /** Mensaje de error; también marca el campo como inválido. */
  error?: ReactNode
  /** El control: un `Input`, `Textarea`, `Select` o cualquier elemento que acepte `id`. */
  children: ReactElement<ControlProps>
  className?: string
}

/**
 * Etiqueta, ayuda y error de un campo, conectados al control.
 *
 * La etiqueta va arriba y visible: antes varios filtros usaban el placeholder
 * como etiqueta, que desaparece al escribir y no lo anuncian todos los
 * lectores de pantalla (doc 18 §3.2). La ayuda y el error llegan al control
 * por `aria-describedby`; el error se anuncia con `role="alert"` y lleva
 * icono, no solo color.
 */
export function Field({ label, hint, error, children, className }: Props) {
  const generatedId = useId()
  const control = isValidElement(children) ? children : null
  const id = control?.props.id ?? generatedId
  // Con error la ayuda no se muestra: su id tampoco puede quedar referenciado.
  const hintId = hint && !error ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [control?.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('flex flex-col', className)}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {control &&
        cloneElement(control, {
          id,
          'aria-describedby': describedBy,
          'aria-invalid': error ? true : control.props['aria-invalid'],
        })}
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 flex items-center gap-1 text-xs font-medium text-danger-fg">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}
