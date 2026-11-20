import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import type { ChangeEvent, InputHTMLAttributes } from 'react'
import { cn } from '../utils/cn'

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> {
  onCheckedChange?: (checked: boolean) => void
}

export function Checkbox({ checked, defaultChecked, onChange, onCheckedChange, className, disabled, required, name, id, 'aria-label': ariaLabel }: CheckboxProps) {
  function handleCheckedChange(next: boolean | 'indeterminate') {
    const nextChecked = next === true
    onCheckedChange?.(nextChecked)
    if (onChange) {
      const target = { checked: nextChecked } as EventTarget & HTMLInputElement
      onChange({ target, currentTarget: target } as ChangeEvent<HTMLInputElement>)
    }
  }

  return (
    <CheckboxPrimitive.Root
      id={id}
      name={name}
      aria-label={ariaLabel}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={handleCheckedChange}
      disabled={disabled}
      required={required}
      className={cn(
        'peer inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-line-control bg-surface text-on-accent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface data-[state=checked]:border-accent-fill data-[state=checked]:bg-accent-fill disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="h-3 w-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
