import type { ContactOrigin, CsvField, ImportSelection, ImportSummary } from '../types'

/**
 * Cuántos contactos pasan de una importación a la agenda.
 *
 * Igual que ManyChat al conectar la app del celular: todos, solo quienes
 * conversaron en los últimos N días, o marcados uno por uno; y en cualquier
 * caso un tope opcional ("como máximo 500"), que se llena empezando por la
 * conversación más reciente.
 */
export type ImportScope = 'all' | 'recent' | 'manual'

export interface SelectionDraft {
  scope: ImportScope
  days: number
  /** Vacío = sin tope. */
  limit: string
  rowIds: number[]
  fillEmpty: boolean
  tags: string
  /** Al terminar, descarta lo que no se eligió y cierra la importación. */
  close: boolean
}

export const DEFAULT_DAYS = 90

export function initialSelection(summary: ImportSummary | undefined): SelectionDraft {
  // Del celular conviene empezar por lo reciente: la agenda trae familia y
  // contactos de hace años. Un CSV se armó a propósito: va entero.
  const fromPhone = summary?.source === 'whatsapp_app' && (summary.counts.with_interaction ?? 0) > 0
  return {
    scope: fromPhone ? 'recent' : 'all',
    days: DEFAULT_DAYS,
    limit: '',
    rowIds: [],
    fillEmpty: false,
    tags: '',
    close: summary?.source === 'csv',
  }
}

export function parsedLimit(limit: string): number | null {
  const value = Number.parseInt(limit, 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Las que entran en el alcance elegido, antes del tope. */
export function scopeCount(summary: ImportSummary, draft: SelectionDraft): number {
  if (draft.scope === 'manual') return draft.rowIds.length
  if (draft.scope === 'recent') return summary.recent.find(item => item.days === draft.days)?.count ?? 0
  return summary.counts.pending
}

export function selectionCount(summary: ImportSummary, draft: SelectionDraft): number {
  const count = scopeCount(summary, draft)
  const limit = parsedLimit(draft.limit)
  return limit === null ? count : Math.min(count, limit)
}

export function splitTags(value: string): string[] {
  const seen = new Set<string>()
  return value.split(/[,;]/).map(tag => tag.trim()).filter(tag => {
    const key = tag.toLocaleLowerCase('es')
    if (!tag || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function toSelection(draft: SelectionDraft): ImportSelection {
  return {
    mode: draft.scope,
    days: draft.scope === 'recent' ? draft.days : null,
    limit: parsedLimit(draft.limit),
    row_ids: draft.scope === 'manual' ? draft.rowIds : [],
    duplicates: draft.fillEmpty ? 'fill_empty' : 'skip',
    tags: splitTags(draft.tags),
    close: draft.close,
  }
}

export function recentLabel(days: number): string {
  if (days === 1) return 'Último día'
  if (days === 7) return 'Última semana'
  if (days === 30) return 'Último mes'
  if (days === 90) return 'Últimos 3 meses'
  if (days === 180) return 'Últimos 6 meses'
  return `Últimos ${days} días`
}

export const ORIGIN_LABELS: Record<ContactOrigin, string> = {
  manual: 'Agregado a mano',
  csv: 'Importado de CSV',
  whatsapp_app: 'Celular',
  lead: 'Escribió por WhatsApp',
}

export const CSV_FIELD_LABELS: Record<CsvField, string> = {
  nombre: 'Nombre',
  telefono: 'Teléfono',
  email: 'Correo',
  etiquetas: 'Etiquetas',
  notas: 'Notas',
  consentimiento: 'Acepta publicidad',
}

export function contactsLabel(count: number): string {
  return count === 1 ? '1 contacto' : `${count.toLocaleString('es-PE')} contactos`
}

/** "+51 987 654 321" para leer; el valor guardado son solo dígitos. */
export function formatPhone(phone: string | null): string {
  if (!phone) return ''
  if (phone.startsWith('51') && phone.length === 11) {
    return `+51 ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`
  }
  return `+${phone}`
}
