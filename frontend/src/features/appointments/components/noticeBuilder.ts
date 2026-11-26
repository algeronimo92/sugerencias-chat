import { parseLine, serializeLine, type PieceDraft as TemplateDraft } from '../../../shared/pieces'
import type { VariableFieldGroup } from '../../../shared/ui/VariablesBuilder'
import { templateVariables } from '../domain/notice'
import { joinOffset, type OffsetUnit } from '../domain/reminders'
import type { NoticeSettings } from '../types'

/** Lo que comparten el armador de los avisos y el de los recordatorios: la
 *  misma lista de campos y de plantillas, la misma forma de armar cada
 *  variable. */
export type NoticeTemplateOption = NoticeSettings['templates'][number]
export type NoticeFieldOption = NoticeSettings['fields'][number]

// "Del recordatorio" solo tiene campos en los recordatorios (cuándo y cuánto
// falta): en los avisos queda vacío y el armador no lo muestra.
const GROUPS = [
  { id: 'recordatorio', label: 'Del recordatorio' },
  { id: 'cita', label: 'De la cita' },
  { id: 'cita_personalizado', label: 'Campos de la cita' },
  { id: 'lead', label: 'Del lead' },
  { id: 'lead_personalizado', label: 'Campos del lead' },
]

export function groupsOf(fields: NoticeFieldOption[]): VariableFieldGroup[] {
  return GROUPS.map(group => ({ ...group, fields: fields.filter(field => field.group === group.id) }))
}

/** Lo que se guardó para esta plantilla o, si no hay nada, lo que se armó
 *  para sus variables en Plantillas: nunca se empieza de cero. */
export function startingParameters(
  saved: { templateId: number | null; parameters: string[] },
  template: NoticeTemplateOption | null,
): string[] {
  if (!template) return []
  if (template.id === saved.templateId && saved.parameters.some(Boolean)) return saved.parameters
  return template.suggested_parameters
}

export function slotsOf(template: NoticeTemplateOption | null): string[] {
  if (!template) return []
  const names = templateVariables(template.content)
  const count = Math.max(template.variable_count, names.length)
  return Array.from({ length: count }, (_, index) => names[index] ?? String(index + 1))
}

export function draftOf(parameters: string[], count: number, knownKeys: Set<string>): TemplateDraft {
  return { title: [], lines: Array.from({ length: count }, (_, index) => parseLine(parameters[index] ?? '', knownKeys)) }
}

/** Un recordatorio mientras se edita. La anticipación se guarda como la
 *  escribe el usuario (cantidad y unidad) para no corregirle lo que tipea. */
export interface ReminderDraft {
  key: string
  amount: number
  unit: OffsetUnit
  enabled: boolean
  templateId: number | null
  draft: TemplateDraft
  /** Lo que estaba guardado, para volver a la plantilla elegida sin perderlo. */
  saved: { templateId: number | null; parameters: string[] }
}

export function offsetOf(row: ReminderDraft): number {
  return joinOffset(row.amount, row.unit)
}

export function parametersOf(row: ReminderDraft): string[] {
  return row.draft.lines.map(serializeLine)
}
