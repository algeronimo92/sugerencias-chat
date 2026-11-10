import { Input, Select, Textarea } from '../../../shared/ui/Input'
import type { CustomFieldDefinition } from '../hooks/useCustomFields'

interface Props {
  field: CustomFieldDefinition
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  className?: string
  /** Si el campo es un monto: la moneda del negocio (código ISO). Muestra su
   *  símbolo, no acepta negativos y pide como mucho dos decimales. */
  currency?: string | null
}

/** "S/" para PEN, "$" para USD... Con un código que el navegador no conoce se
 *  muestra el código tal cual; sin moneda, nada. */
function currencySymbol(currency: string | null | undefined): string | null {
  if (!currency) return null
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).formatToParts(0)
      .find(part => part.type === 'currency')?.value ?? currency
  } catch {
    return currency
  }
}

export function CustomFieldInput({ field, value, onChange, disabled, className, currency }: Props) {
  const id = `custom-field-${field.entity_type}-${field.key}`
  const common = { id, disabled, required: field.required, className }
  if (field.field_type === 'textarea') {
    return <Textarea {...common} rows={3} value={String(value ?? '')} onChange={event => onChange(event.target.value)} />
  }
  if (field.field_type === 'select') {
    return (
      <Select {...common} value={String(value ?? '')} onValueChange={onChange}>
        <option value="">Selecciona una opción</option>
        {field.options.map(option => <option key={option} value={option}>{option}</option>)}
      </Select>
    )
  }
  if (field.field_type === 'boolean') {
    return (
      <span className="flex min-h-11 items-center gap-2 rounded-lg border border-wa-border bg-wa-field px-3 text-sm dark:border-wa-border-dark dark:bg-wa-field-dark">
        <input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={event => onChange(event.target.checked)} />
        Sí
      </span>
    )
  }
  if (field.field_type === 'number') {
    // Sin `step` el navegador solo acepta enteros y rechaza 14.5 al guardar.
    const isMoney = currency !== undefined
    const symbol = currencySymbol(currency)
    const input = (
      <Input
        {...common}
        type="number"
        inputMode="decimal"
        step={isMoney ? '0.01' : 'any'}
        min={isMoney ? 0 : undefined}
        value={String(value ?? '')}
        onChange={event => onChange(event.target.value)}
        className={`${className ?? ''} ${symbol ? 'pl-11' : ''}`}
      />
    )
    if (!symbol) return input
    return (
      <span className="relative block">
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-wa-muted dark:text-wa-muted-dark">
          {symbol}
        </span>
        {input}
      </span>
    )
  }
  return (
    <Input
      {...common}
      type={field.field_type === 'date' ? 'date' : field.field_type === 'datetime' ? 'datetime-local' : 'text'}
      value={String(value ?? '')}
      onChange={event => onChange(event.target.value)}
    />
  )
}
