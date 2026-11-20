import { useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { CustomFieldInput } from '../../catalogs/public/CustomFieldInput'
import { useCustomFields } from '../../catalogs/public/useCustomFields'
import { useLeadCustomFieldValues, useUpdateLeadCustomFieldValues } from '../hooks/useLeadCustomFieldValues'

function displayValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return String(value)
}

/**
 * Campos propios del negocio dentro de la sección Datos de la ficha, con su
 * propio modo de edición. El error de guardado se muestra acá: antes iba al
 * diálogo de "Editar lead", que en ese momento estaba cerrado, y no se veía.
 */
export function LeadCustomFields({ chatId }: { chatId: string }) {
  const { data: definitions = [] } = useCustomFields('lead')
  const { data: values = {} } = useLeadCustomFieldValues(chatId)
  const update = useUpdateLeadCustomFieldValues(chatId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)

  if (definitions.length === 0) return null

  function toggleEditing() {
    if (!editing) setDraft(values)
    setError(null)
    setEditing(!editing)
  }

  function save() {
    setError(null)
    update.mutate(draft, {
      onSuccess: () => setEditing(false),
      onError: (err) => setError(extractErrorMessage(err)),
    })
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-fg-muted">Campos del negocio</h4>
        <Button variant="link" size="sm" onClick={toggleEditing}>{editing ? 'Cancelar' : 'Editar'}</Button>
      </div>
      {editing ? (
        <div className="space-y-3">
          {definitions.map((field) => (
            <label key={field.id} className="block text-xs font-medium text-fg-muted">
              {field.label}{field.required ? ' *' : ''}
              <CustomFieldInput
                field={field}
                value={draft[field.key]}
                onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
                className="mt-1"
              />
            </label>
          ))}
          <Button size="sm" loading={update.isPending} onClick={save}>Guardar campos</Button>
        </div>
      ) : (
        <dl className="space-y-2">
          {definitions.map((field) => {
            const value = values[field.key]
            if (value == null || value === '') return null
            return (
              <div key={field.id} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 text-sm">
                <dt className="pt-px text-xs text-fg-muted">{field.label}</dt>
                <dd className="break-words leading-snug text-fg">{displayValue(value)}</dd>
              </div>
            )
          })}
        </dl>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger-fg">{error}</p>}
    </div>
  )
}
