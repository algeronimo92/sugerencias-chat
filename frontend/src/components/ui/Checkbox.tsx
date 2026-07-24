import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import type { ChangeEvent, InputHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> {
  onCheckedChange?: (checked: boolean) => void
}

export function Checkbox({ checked, defaultChecked, onChange, onCheckedChange, className, disabled, required, name, id }: CheckboxProps) {
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
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={handleCheckedChange}
      disabled={disabled}
      required={required}
      className={cn(
        'peer inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-wa-muted/50 bg-white text-white shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-wa-primary/60 data-[state=checked]:border-wa-primary data-[state=checked]:bg-wa-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-wa-muted-dark/60 dark:bg-wa-head-dark',
        className,
      )}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="h-3 w-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
