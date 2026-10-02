import { ListPlus,Loader2,Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Input,Select } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useCreateCustomField,useCustomFields,useUpdateCustomField,type CustomFieldEntity,type CustomFieldType } from '../hooks/useCustomFields'

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Texto', textarea: 'Texto largo', number: 'Número', date: 'Fecha',
  datetime: 'Fecha y hora', boolean: 'Sí / no', select: 'Lista de opciones',
}

export function CustomFieldsManagementPanel() {
  const [entityType, setEntityType] = useState<CustomFieldEntity>('appointment')
  const { data: fields = [], isLoading } = useCustomFields(entityType, true)
  const createField = useCreateCustomField()
  const updateField = useUpdateCustomField()
  const [label, setLabel] = useState('')
  const [fieldType, setFieldType] = useState<CustomFieldType>('text')
  const [required, setRequired] = useState(false)
  const [options, setOptions] = useState('')
  const [error, setError] = useState<string | null>(null)

  function create(event: React.FormEvent) {
    event.preventDefault(); setError(null)
    createField.mutate({
      entity_type: entityType, label: label.trim(), field_type: fieldType,
      required, options: fieldType === 'select' ? options.split(',').map(item => item.trim()).filter(Boolean) : [],
      position: fields.length,
    }, {
      onSuccess: () => { setLabel(''); setOptions(''); setRequired(false); toast.success('Campo creado') },
      onError: value => setError(extractErrorMessage(value)),
    })
  }

  return (
    <section className="rounded-xl border border-wa-border bg-white p-5 dark:border-wa-border-dark dark:bg-wa-panel-dark">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><ListPlus className="h-5 w-5 text-wa-primary" />Campos personalizados</h2><p className="mt-1 text-sm text-wa-muted">Cada negocio decide qué datos adicionales necesita, sin cambiar el código ni la base.</p></div><Select value={entityType} onValueChange={value => setEntityType(value as CustomFieldEntity)} className="sm:w-44"><option value="appointment">Citas</option><option value="lead">Leads</option></Select></div>
      <form onSubmit={create} className="mt-5 grid gap-3 rounded-lg bg-wa-field p-4 dark:bg-wa-field-dark sm:grid-cols-[1fr_12rem_auto]">
        <Input value={label} onChange={event => setLabel(event.target.value)} placeholder="Nombre del campo" maxLength={80} />
        <Select value={fieldType} onValueChange={value => setFieldType(value as CustomFieldType)}>{Object.entries(TYPE_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</Select>
        <Button type="submit" disabled={!label.trim() || createField.isPending}>{createField.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Crear</Button>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={required} onChange={event => setRequired(event.target.checked)} />Obligatorio</label>
        {fieldType === 'select' && <Input value={options} onChange={event => setOptions(event.target.value)} placeholder="Opciones separadas por coma" className="sm:col-span-2" />}
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      {isLoading ? <p className="py-10 text-center text-sm text-wa-muted">Cargando…</p> : fields.length === 0 ? <p className="py-10 text-center text-sm text-wa-muted">Todavía no hay campos para {entityType === 'appointment' ? 'citas' : 'leads'}.</p> : <div className="mt-5 divide-y divide-wa-border dark:divide-wa-border-dark">{fields.map(field => <div key={field.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-medium">{field.label}{field.required && <span className="ml-1 text-red-500">*</span>}</p><p className="text-xs text-wa-muted">{TYPE_LABELS[field.field_type]} · clave: {field.key}{field.options.length ? ` · ${field.options.join(', ')}` : ''}</p></div><Button variant="secondary" size="sm" disabled={updateField.isPending} onClick={() => updateField.mutate({ id: field.id, is_active: !field.is_active }, { onError: value => setError(extractErrorMessage(value)) })}>{field.is_active ? 'Desactivar' : 'Activar'}</Button></div>)}</div>}
    </section>
  )
}
