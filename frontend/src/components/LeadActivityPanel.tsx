import { ChevronDown, History, Loader2 } from 'lucide-react'
import { useLeadActivity } from '../hooks/useLeadMeta'
import { parseContent } from '../utils/message'
import type { LeadActivity } from '../types'

const EVENT_LABELS: Record<string, string> = {
  lead_created: 'Lead creado',
  lead_updated: 'Datos actualizados',
  stage_changed: 'Estado modificado',
  tag_added: 'Etiqueta agregada',
  tag_removed: 'Etiqueta eliminada',
  internal_note_created: 'Nota interna creada',
  internal_note_updated: 'Nota interna modificada',
  internal_note_deleted: 'Nota interna eliminada',
}

const FIELD_LABELS: Record<string, string> = {
  stage: 'Estado',
  name: 'Nombre',
  nombre: 'Nombre',
  phone: 'Teléfono',
  telefono: 'Teléfono',
  servicio_interes: 'Servicio',
  vendedor: 'Vendedor',
  origen: 'Origen',
  notas: 'Notas',
  content: 'Nota',
  tag: 'Etiqueta',
}

const HIDDEN_FIELDS = new Set(['vendedor_id'])

function actorLabel(item: LeadActivity): string {
  if (item.actor_name) return item.actor_name
  if (item.actor_type === 'agent') return 'Agente IA'
  if (item.actor_type === 'n8n') return 'n8n'
  return 'Sistema'
}

function humanizeKey(value: string): string {
  const label = value.replaceAll('_', ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? humanizeKey(eventType)
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? humanizeKey(field)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function valueLabel(value: unknown): string {
  if (value == null || value === '') return 'Sin definir'
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(valueLabel).join(', ') : 'Ninguno'
  }
  if (isRecord(value)) {
    const nestedTag = isRecord(value.tag) ? value.tag : null
    if (typeof nestedTag?.name === 'string') return nestedTag.name
    if (typeof value.name === 'string') return value.name
    if (typeof value.label === 'string') return value.label

    const details = Object.entries(value)
      .filter(([key]) => key !== 'id' && key !== 'color' && !key.endsWith('_id'))
      .map(([key, nestedValue]) => `${fieldLabel(key)}: ${valueLabel(nestedValue)}`)
    return details.length > 0 ? details.join(', ') : 'Información actualizada'
  }
  return String(value).replaceAll('_', ' ')
}

function changeSummary(item: LeadActivity): string | null {
  const oldValue = item.old_value ?? {}
  const newValue = item.new_value ?? {}
  const keys = Array.from(new Set([...Object.keys(oldValue), ...Object.keys(newValue)]))
    .filter((key) => !HIDDEN_FIELDS.has(key))
  if (keys.length === 0) return null
  return keys.map((key) => {
    const hasOldValue = Object.hasOwn(oldValue, key)
    const hasNewValue = Object.hasOwn(newValue, key)
    const label = fieldLabel(key)

    if (!hasOldValue) return `${label}: ${valueLabel(newValue[key])}`
    if (!hasNewValue) return `${label}: ${valueLabel(oldValue[key])}`
    return `${label}: ${valueLabel(oldValue[key])} → ${valueLabel(newValue[key])}`
  }).join(' · ')
}

export function LeadActivityPanel({ chatId }: { chatId: string }) {
  const { data = [], isLoading } = useLeadActivity(chatId)

  return (
    <details className="group rounded-xl border border-wa-border bg-white shadow-sm dark:border-wa-border-dark dark:bg-wa-head-dark">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
        <History className="h-3.5 w-3.5" /> Historial de cambios
        <span className="ml-auto rounded-full bg-wa-field px-1.5 py-0.5 text-[10px] dark:bg-wa-active-dark">{data.length}</span>
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="max-h-72 space-y-3 overflow-y-auto border-t border-wa-border p-3 dark:border-wa-border-dark">
        {isLoading && <Loader2 className="mx-auto h-4 w-4 animate-spin text-wa-muted" />}
        {!isLoading && data.length === 0 && <p className="text-center text-xs text-wa-muted">Todavía no hay cambios registrados.</p>}
        {data.map((item) => {
          const summary = changeSummary(item)
          const triggerContent = (item.metadata?.trigger_message as { content?: string } | undefined)?.content
          const trigger = triggerContent ? parseContent(triggerContent) : null
          return (
            <div key={item.id} className="relative border-l-2 border-wa-primary pl-3">
              <p className="text-xs font-medium text-gray-800 dark:text-wa-text-dark">{eventLabel(item.event_type)}</p>
              <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">{actorLabel(item)} · {new Date(item.created_at).toLocaleString('es-PE')}</p>
              {summary && <p className="mt-1 text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">{summary}</p>}
              {item.metadata?.reason != null && (
                <p className="mt-1 text-[11px] italic text-wa-muted">{String(item.metadata.reason)}</p>
              )}
              {trigger && (trigger.text || trigger.label) && (
                <p className="mt-1 border-l-2 border-wa-primary/50 pl-2 text-[11px] italic text-gray-600 dark:text-gray-300">
                  «{trigger.text || trigger.label}»
                </p>
              )}
            </div>
          )
        })}
      </div>
    </details>
  )
}
