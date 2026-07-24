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
import { cn } from '../../utils/cn'

export const fieldClass =
  'w-full text-sm bg-wa-field dark:bg-wa-field-dark text-wa-text dark:text-wa-text-dark border border-transparent rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-wa-primary/60 focus:border-transparent aria-invalid:border-red-500 aria-invalid:ring-red-500/25 placeholder:text-wa-muted dark:placeholder:text-wa-muted-dark transition-[box-shadow,border-color,background-color] disabled:cursor-not-allowed disabled:opacity-50'

export const pillFieldClass =
  'w-full text-sm bg-wa-field dark:bg-wa-field-dark text-wa-text dark:text-wa-text-dark border border-transparent rounded-full px-3 py-1.5 outline-none focus:ring-2 focus:ring-wa-primary/60 placeholder:text-wa-muted dark:placeholder:text-wa-muted-dark transition-[box-shadow,background-color] disabled:cursor-not-allowed disabled:opacity-50'

export const labelClass = 'mb-1 block text-xs font-medium text-wa-muted dark:text-wa-muted-dark'

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
        className={cn(
          fieldClass,
          'flex min-h-9 items-center justify-between gap-2 text-left shadow-sm data-[placeholder]:text-wa-muted dark:data-[placeholder]:text-wa-muted-dark',
          className,
        )}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-4 w-4 shrink-0 text-wa-muted transition-transform duration-150 dark:text-wa-muted-dark" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={5}
          collisionPadding={8}
          className="ui-select-content z-[120] max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-wa-border bg-white text-wa-text shadow-xl dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark"
        >
          <SelectPrimitive.ScrollUpButton className="flex h-7 items-center justify-center bg-white text-wa-muted dark:bg-wa-head-dark dark:text-wa-muted-dark">
            <ChevronUp className="h-4 w-4" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option, index) => {
              const showGroup = option.group != null && option.group !== lastGroup
              lastGroup = option.group
              return (
                <SelectPrimitive.Group key={`${option.value}-${index}`}>
                  {showGroup && <SelectPrimitive.Label className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">{option.group}</SelectPrimitive.Label>}
                  <SelectPrimitive.Item
                    value={option.value === '' ? EMPTY_VALUE : option.value}
                    disabled={option.disabled}
                    className="relative flex cursor-default select-none items-center rounded-md py-2 pl-3 pr-9 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-wa-active data-[highlighted]:text-wa-text dark:data-[highlighted]:bg-wa-active-dark dark:data-[highlighted]:text-wa-text-dark"
                  >
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="absolute right-2.5 inline-flex items-center text-wa-primary-strong dark:text-wa-primary">
                      <Check className="h-4 w-4" />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                </SelectPrimitive.Group>
              )
            })}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-7 items-center justify-center bg-white text-wa-muted dark:bg-wa-head-dark dark:text-wa-muted-dark">
            <ChevronDown className="h-4 w-4" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
