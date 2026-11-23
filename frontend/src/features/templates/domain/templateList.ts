import type { MessageTemplate } from '../types'

export type TypeFilter = 'all' | 'internal' | 'official'
export type StatusFilter = 'any' | 'approved' | 'review' | 'rejected' | 'inactive'

export interface TemplateListFilters {
  query: string
  type: TypeFilter
  status: StatusFilter
  category: string
}

export const NO_FILTERS: TemplateListFilters = { query: '', type: 'all', status: 'any', category: '' }

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral'

export interface OfficialStatus {
  kind: 'approved' | 'review' | 'rejected' | 'blocked' | 'unsent'
  label: string
  tone: StatusTone
}

/**
 * El estado de Meta en palabras del equipo. Antes la lista mostraba el valor
 * crudo («APPROVED», «PENDING») y todos en el mismo azul, así que una
 * rechazada no se distinguía de una aprobada.
 */
export function officialStatus(status: string | null | undefined): OfficialStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'APPROVED': return { kind: 'approved', label: 'Aprobada', tone: 'success' }
    case 'PENDING':
    case 'IN_APPEAL': return { kind: 'review', label: 'En revisión', tone: 'warning' }
    case 'REJECTED': return { kind: 'rejected', label: 'Rechazada', tone: 'danger' }
    case 'PAUSED': return { kind: 'blocked', label: 'Pausada por Meta', tone: 'warning' }
    case 'DISABLED': return { kind: 'blocked', label: 'Deshabilitada por Meta', tone: 'danger' }
    case '': return { kind: 'unsent', label: 'Sin enviar a Meta', tone: 'neutral' }
    default: return { kind: 'blocked', label: status ?? '', tone: 'neutral' }
  }
}

const REJECTED_REASONS: Record<string, string> = {
  ABUSIVE_CONTENT: 'Meta consideró el contenido abusivo o engañoso',
  INVALID_FORMAT: 'El formato no es válido: revisa los datos, los saltos de línea y la estructura',
  TAG_CONTENT_MISMATCH: 'El texto no coincide con el tipo de mensaje elegido',
  INCORRECT_CATEGORY: 'El tipo de mensaje no corresponde a este texto',
  SCAM: 'Meta lo identificó como posible estafa',
  NONE: 'Meta no informó el motivo',
}

export function rejectedReason(reason: string | null | undefined): string | null {
  if (!reason) return null
  return REJECTED_REASONS[reason] ?? reason
}

const OFFICIAL_CATEGORIES: Record<string, string> = {
  UTILITY: 'Aviso',
  MARKETING: 'Promoción',
  AUTHENTICATION: 'Código de verificación',
}

export function officialCategoryLabel(category: string | null | undefined): string {
  return OFFICIAL_CATEGORIES[category ?? ''] ?? category ?? ''
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function matchesStatus(template: MessageTemplate, status: StatusFilter): boolean {
  if (status === 'any') return true
  if (status === 'inactive') return !template.is_active
  return template.template_type === 'official' && officialStatus(template.official_status).kind === status
}

export function filterTemplates(templates: MessageTemplate[], filters: TemplateListFilters): MessageTemplate[] {
  const query = normalize(filters.query.trim().replace(/^\//, ''))
  return templates.filter(template => {
    if (filters.type !== 'all' && template.template_type !== filters.type) return false
    if (filters.category && template.category !== filters.category) return false
    if (!matchesStatus(template, filters.status)) return false
    if (!query) return true
    return [template.name, template.content, template.shortcut ?? '', template.official_name ?? '']
      .some(value => normalize(value).includes(query))
  })
}

/** Las más usadas primero; a igual uso, por nombre. */
export function sortByUse(templates: MessageTemplate[]): MessageTemplate[] {
  return [...templates].sort((left, right) => right.use_count - left.use_count || left.name.localeCompare(right.name, 'es'))
}

export function hasFilters(filters: TemplateListFilters): boolean {
  return filters.query.trim() !== '' || filters.type !== 'all' || filters.status !== 'any' || filters.category !== ''
}

/** El texto de la plantilla en una línea, sin las marcas de formato. */
export function snippet(content: string): string {
  return content.replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim()
}
