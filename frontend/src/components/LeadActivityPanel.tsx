import { ChevronDown, History, Loader2 } from 'lucide-react'
import { useLeadActivity } from '../hooks/useLeadMeta'
import type { LeadActivity } from '../types'

const EVENT_LABELS: Record<string, string> = {
  lead_created: 'Lead creado',
  lead_updated: 'Datos actualizados',
  stage_changed: 'Estado modificado',
  tag_added: 'Etiqueta agregada',
  tag_removed: 'Etiqueta eliminada',
}

const FIELD_LABELS: Record<string, string> = {
  stage: 'Estado',
  nombre: 'Nombre',
  telefono: 'Teléfono',
  servicio_interes: 'Servicio',
  vendedor: 'Vendedor',
  origen: 'Origen',
  notas: 'Notas',
}

function actorLabel(item: LeadActivity): string {
  if (item.actor_name) return item.actor_name
  if (item.actor_type === 'agent') return 'Agente IA'
  if (item.actor_type === 'n8n') return 'n8n'
  return 'Sistema'
}

function valueLabel(value: unknown): string {
  if (value == null || value === '') return 'Sin definir'
  if (typeof value === 'object') {
    const tag = (value as { tag?: { name?: string } }).tag
    if (tag?.name) return tag.name
    return JSON.stringify(value)
  }
  return String(value).replaceAll('_', ' ')
}

function changeSummary(item: LeadActivity): string | null {
  const oldValue = item.old_value ?? {}
  const newValue = item.new_value ?? {}
  const keys = Array.from(new Set([...Object.keys(oldValue), ...Object.keys(newValue)]))
  if (keys.length === 0) return null
  return keys.map((key) => `${FIELD_LABELS[key] ?? key}: ${valueLabel(oldValue[key])} → ${valueLabel(newValue[key])}`).join(' · ')
}

export function LeadActivityPanel({ chatId }: { chatId: string }) {
  const { data = [], isLoading } = useLeadActivity(chatId)

  return (
    <details className="group rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <History className="h-3.5 w-3.5" /> Historial de cambios
        <span className="ml-auto rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] dark:bg-gray-700">{data.length}</span>
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="max-h-72 space-y-3 overflow-y-auto border-t border-gray-100 p-3 dark:border-gray-700">
        {isLoading && <Loader2 className="mx-auto h-4 w-4 animate-spin text-gray-400" />}
        {!isLoading && data.length === 0 && <p className="text-center text-xs text-gray-400">Todavía no hay cambios registrados.</p>}
        {data.map((item) => {
          const summary = changeSummary(item)
          return (
            <div key={item.id} className="relative border-l-2 border-green-500 pl-3">
              <p className="text-xs font-medium text-gray-800 dark:text-gray-200">{EVENT_LABELS[item.event_type] ?? item.event_type}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{actorLabel(item)} · {new Date(item.created_at).toLocaleString('es-PE')}</p>
              {summary && <p className="mt-1 text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">{summary}</p>}
              {item.metadata?.reason != null && (
                <p className="mt-1 text-[11px] italic text-gray-500">{String(item.metadata.reason)}</p>
              )}
            </div>
          )
        })}
      </div>
    </details>
  )
}
