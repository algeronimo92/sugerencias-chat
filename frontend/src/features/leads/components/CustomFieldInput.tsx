import { Input,Select,Textarea } from '../../../shared/ui/Input'
import type { CustomFieldDefinition } from '../hooks/useCustomFields'

interface Props {
  field: CustomFieldDefinition
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  className?: string
}

export function CustomFieldInput({ field, value, onChange, disabled, className }: Props) {
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
  return (
    <Input
      {...common}
      type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : field.field_type === 'datetime' ? 'datetime-local' : 'text'}
      value={String(value ?? '')}
      onChange={event => onChange(event.target.value)}
    />
  )
}
