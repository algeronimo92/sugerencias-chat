/**
 * Claves de caché de React Query de esta feature. Son el contrato con el que
 * otras features y el tiempo real refrescan sus datos: nadie escribe una clave
 * a mano fuera de un `keys.ts` (lo verifica src/test/architecture.test.ts).
 * Cada `all` es el prefijo de su familia: invalidarlo alcanza a todas sus
 * variantes.
 */

import type { ChatFilters } from './types'

export const leadKeys = {
  /** El listado de leads (la bandeja de chats lo muestra). */
  all: ['chats'] as const,
  lists: ['chats', 'list'] as const,
  list: (search: string, filters: ChatFilters) => ['chats', 'list', search, filters] as const,
  detailAll: ['chat'] as const,
  detail: (chatId: string | null) => ['chat', chatId] as const,
  phoneConfig: ['phone-config'] as const,
  duplicate: (digits: string | null) => ['duplicate-lead', digits] as const,
  activityAll: ['lead-activity'] as const,
  activity: (chatId: string | null) => ['lead-activity', chatId] as const,
  search: (term: string) => ['lead-search', term] as const,
}

export const kanbanKeys = {
  all: ['kanban'] as const,
  snapshot: (search: string) => ['kanban', 'snapshot', search] as const,
}

export const stageKeys = {
  all: ['lead-stages'] as const,
  list: ['lead-stages', 'list'] as const,
  admin: ['lead-stages', 'admin'] as const,
}

export const tagKeys = {
  all: ['tags'] as const,
  list: (includeInactive: boolean) => ['tags', { includeInactive }] as const,
}

export const serviceKeys = {
  all: ['lead-services'] as const,
  list: (includeInactive: boolean) => ['lead-services', { includeInactive }] as const,
}

export const customFieldKeys = {
  all: ['custom-fields'] as const,
  list: (entityType: string, includeInactive: boolean) => ['custom-fields', entityType, { includeInactive }] as const,
  leadValues: (leadId: string | null) => ['lead-custom-fields', leadId] as const,
}
