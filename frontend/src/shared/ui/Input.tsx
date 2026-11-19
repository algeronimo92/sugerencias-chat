import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import {
  Children,
  forwardRef,
  isValidElement,
  type ChangeEvent,
  type InputHTMLAttributes,
  type OptionHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '../utils/cn'

// Borde line-control (3,1:1): antes el campo era gris sobre gris sin borde
// (1,1:1) y no se distinguía dónde escribir (WCAG 1.4.11, doc 18 §3.2).
export const fieldClass =
  'w-full text-sm bg-surface text-fg border border-line-control rounded-lg px-3 py-2 outline-none focus:border-accent-strong focus:ring-2 focus:ring-ring/25 aria-invalid:border-danger aria-invalid:ring-danger/25 placeholder:text-fg-muted transition-[box-shadow,border-color,background-color] disabled:cursor-not-allowed disabled:opacity-50'

// La búsqueda conserva la píldora sin borde: es el patrón de WhatsApp y la
// lupa la identifica.
export const pillFieldClass =
  'w-full text-sm bg-subtle text-fg border border-transparent rounded-full px-3 py-1.5 outline-none focus:ring-2 focus:ring-ring/40 placeholder:text-fg-muted transition-[box-shadow,background-color] disabled:cursor-not-allowed disabled:opacity-50'

export const labelClass = 'mb-1.5 block text-sm font-medium text-fg'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(fieldClass, className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(fieldClass, className)} {...rest} />
})

const EMPTY_VALUE = '__dermicapro_empty_select_value__'

interface SelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
  group?: ReactNode
}

function collectOptions(children: ReactNode, group?: ReactNode): SelectOption[] {
  const options: SelectOption[] = []
  Children.forEach(children, child => {
    if (!isValidElement(child)) return
    if (child.type === 'option') {
      const props = child.props as OptionHTMLAttributes<HTMLOptionElement>
      options.push({
        value: String(props.value ?? props.children ?? ''),
        label: props.children,
        disabled: props.disabled,
        group,
      })
      return
    }
    if (child.type === 'optgroup') {
      const props = child.props as { label?: ReactNode; children?: ReactNode }
      options.push(...collectOptions(props.children, props.label))
    }
  })
  return options
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  onValueChange?: (value: string) => void
}

/**
 * Select accesible y completamente personalizable. Conserva la API básica del
 * `<select>` nativo para poder modernizar formularios existentes sin cambiar
 * su lógica de negocio.
 */
export function Select({
  children,
  value,
  defaultValue,
  onChange,
  onValueChange,
  className,
  disabled,
  required,
  name,
  id,
  title,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: SelectProps) {
  const options = collectOptions(children)
  const normalizedValue = String(value ?? defaultValue ?? '')
  const encodedValue = normalizedValue === '' ? EMPTY_VALUE : normalizedValue

  function handleValueChange(nextEncodedValue: string) {
    const nextValue = nextEncodedValue === EMPTY_VALUE ? '' : nextEncodedValue
    onValueChange?.(nextValue)
    if (onChange) {
      const target = { value: nextValue } as EventTarget & HTMLSelectElement
      onChange({ target, currentTarget: target } as ChangeEvent<HTMLSelectElement>)
    }
  }

  let lastGroup: ReactNode

  return (
    <SelectPrimitive.Root
      value={encodedValue}
      onValueChange={handleValueChange}
      disabled={disabled}
      required={required}
      name={name}
    >
      <SelectPrimitive.Trigger
        id={id}
        title={title}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        // La ayuda y el error del campo: sin esto el lector de pantalla no
        // los anuncia al llegar al selector.
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        className={cn(
          fieldClass,
          'group relative flex min-h-10 min-w-0 cursor-pointer items-center gap-3 text-left enabled:hover:border-fg-muted data-[placeholder]:text-fg-muted',
          className,
          'pr-10',
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          <SelectPrimitive.Value />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-fg-muted transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        {/* z-[145]: por encima de cualquier diálogo (el más alto es el de
            confirmación, z-[131], y la salida del editor de flujos, z-[140]);
            un menú abierto desde un diálogo no puede quedar por detrás de él.
            Debajo de los tooltips (z-[150]). */}
        <SelectPrimitive.Content
          position="popper"
          sideOffset={5}
          collisionPadding={8}
          className="ui-select-content z-[145] max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-line bg-surface-raised text-fg shadow-popover"
        >
          <SelectPrimitive.ScrollUpButton className="flex h-7 items-center justify-center bg-surface-raised text-fg-muted">
            <ChevronUp className="h-4 w-4" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option, index) => {
              const showGroup = option.group != null && option.group !== lastGroup
              lastGroup = option.group
              return (
                <SelectPrimitive.Group key={`${option.value}-${index}`}>
                  {showGroup && <SelectPrimitive.Label className="px-2 py-1.5 text-xs font-semibold text-fg-muted">{option.group}</SelectPrimitive.Label>}
                  <SelectPrimitive.Item
                    value={option.value === '' ? EMPTY_VALUE : option.value}
                    disabled={option.disabled}
                    className="relative flex cursor-default select-none items-center rounded-md py-2 pl-3 pr-9 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-subtle data-[highlighted]:text-fg data-[state=checked]:font-medium"
                  >
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="absolute right-2.5 inline-flex items-center text-accent-strong">
                      <Check className="h-4 w-4" />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                </SelectPrimitive.Group>
              )
            })}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-7 items-center justify-center bg-surface-raised text-fg-muted">
            <ChevronDown className="h-4 w-4" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
