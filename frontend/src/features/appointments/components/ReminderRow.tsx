import { Trash2 } from 'lucide-react'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { Input, Select, fieldClass, labelClass } from '../../../shared/ui/Input'
import { VariablesBuilder } from '../../../shared/ui/VariablesBuilder'
import { previewNotice, renderParameter } from '../domain/notice'
import { describeOffset, type OffsetUnit } from '../domain/reminders'
import type { ReminderSettings } from '../types'
import { draftOf, groupsOf, offsetOf, parametersOf, slotsOf, startingParameters, type ReminderDraft } from './noticeBuilder'

type Props = {
  row: ReminderDraft
  settings: ReminderSettings
  labels: Map<string, string>
  knownKeys: Set<string>
  error: string | null
  disabled: boolean
  onChange: (row: ReminderDraft) => void
  onRemove: () => void
}

/** La edición de un recordatorio: cuánto antes sale, con qué plantilla y qué
 *  va en cada variable, con la vista previa de cómo le llega al paciente. */
export function ReminderRow({ row, settings, labels, knownKeys, error, disabled, onChange, onRemove }: Props) {
  const template = settings.templates.find(item => item.id === row.templateId) ?? null
  const variables = slotsOf(template)
  const values = settings.preview?.values
  const rendered = parametersOf(row).map(parameter => (parameter ? renderParameter(parameter, labels, values) : ''))
  const id = `reminder-${row.key}`
  const minutes = offsetOf(row)

  const chooseTemplate = (value: string) => {
    const templateId = value ? Number(value) : null
    const next = settings.templates.find(item => item.id === templateId) ?? null
    onChange({ ...row, templateId, draft: draftOf(startingParameters(row.saved, next), slotsOf(next).length, knownKeys) })
  }

  return (
    <li className="space-y-3 rounded-lg border border-wa-border/70 p-3 dark:border-wa-border-dark/70">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark">
          <Checkbox
            checked={row.enabled}
            onCheckedChange={enabled => onChange({ ...row, enabled })}
            disabled={disabled}
            aria-label={`Activar el recordatorio ${Number.isFinite(minutes) ? describeOffset(minutes) : ''} antes`}
          />
          Activo
        </label>
        <div>
          <label htmlFor={`${id}-amount`} className={labelClass}>Anticipación</label>
          <div className="flex items-center gap-2">
            <Input
              id={`${id}-amount`}
              type="number"
              min={1}
              inputMode="numeric"
              value={Number.isFinite(row.amount) ? row.amount : ''}
              onChange={event => onChange({ ...row, amount: event.target.value === '' ? Number.NaN : Number(event.target.value) })}
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              className={`${fieldClass} w-20`}
            />
            <Select
              aria-label="Unidad"
              value={row.unit}
              onValueChange={unit => onChange({ ...row, unit: unit as OffsetUnit })}
              disabled={disabled}
              className={`${fieldClass} w-32`}
            >
              <option value="minutes">minutos</option>
              <option value="hours">horas</option>
              <option value="days">días</option>
            </Select>
            <span className="text-sm text-wa-muted dark:text-wa-muted-dark">antes</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="ml-auto inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-xs font-medium text-wa-muted hover:bg-wa-hover hover:text-red-600 disabled:opacity-50 dark:text-wa-muted-dark dark:hover:bg-wa-head-dark"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Quitar
        </button>
      </div>
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-red-500 dark:text-red-400">{error}</p>}

      <div>
        <label htmlFor={`${id}-template`} className={labelClass}>Plantilla oficial</label>
        <Select id={`${id}-template`} value={row.templateId ?? ''} onValueChange={chooseTemplate} disabled={disabled} className={fieldClass}>
          <option value="">Elige una plantilla aprobada</option>
          {settings.templates.map(item => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
        </Select>
      </div>

      {template && variables.length > 0 && (
        <VariablesBuilder
          groups={groupsOf(settings.fields)}
          labels={labels}
          variables={variables}
          draft={row.draft}
          rendered={rendered}
          renderedLabel={settings.preview ? 'Con la última cita' : 'Se verá'}
          disabled={disabled}
          onChange={draft => onChange({ ...row, draft })}
        />
      )}

      {template && (
        <div>
          <p className={labelClass}>Así le llega al paciente</p>
          <p className="whitespace-pre-wrap rounded-lg bg-wa-field px-3 py-2 text-sm text-wa-text dark:bg-wa-field-dark dark:text-wa-text-dark">
            {previewNotice(template.content, rendered)}
          </p>
        </div>
      )}
    </li>
  )
}
