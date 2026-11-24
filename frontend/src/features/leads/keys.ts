/**
 * Claves de caché de React Query de esta feature. Son el contrato con el que
 * otras features y el tiempo real refrescan sus datos: nadie escribe una clave
 * a mano fuera de un `keys.ts` (lo verifica src/test/architecture.test.ts).
 * Cada `all` es el prefijo de su familia: invalidarlo alcanza a todas sus
 * variantes.
 */

import type { ChatFilters, ChatOrder } from './types'

export const leadKeys = {
  duplicates: ['duplicate-lead'] as const,
  searchAll: ['lead-search'] as const,
  customFieldsAll: ['lead-custom-fields'] as const,
  /** El listado de leads (la bandeja de chats lo muestra). */
  all: ['chats'] as const,
  lists: ['chats', 'list'] as const,
  list: (search: string, filters: ChatFilters, order: ChatOrder = 'recent') => ['chats', 'list', search, filters, order] as const,
  /** Las dos secciones del buscador de la bandeja. Cuelgan de `all`: un
   *  cambio en un lead las refresca como a la lista. La de mensajes recorre
   *  el historial entero, así que el tiempo real la refresca solo cuando el
   *  mensaje nuevo puede aparecer en ella (`messageSearchTerm`). */
  contactSearch: (search: string, filters: ChatFilters) => ['chats', 'search', 'contacts', search, filters] as const,
  messageSearch: (search: string, filters: ChatFilters) => ['chats', 'search', 'messages', search, filters] as const,
  detailAll: ['chat'] as const,
  detail: (chatId: string | null) => ['chat', chatId] as const,
  phoneConfig: ['phone-config'] as const,
  duplicate: (digits: string | null) => ['duplicate-lead', digits] as const,
  activityAll: ['lead-activity'] as const,
  activity: (chatId: string | null) => ['lead-activity', chatId] as const,
  search: (term: string) => ['lead-search', term] as const,
  /** Cuántos chats hay en cada bandeja. Cuelga de `all`: lo refresca el
   *  mismo tiempo real que refresca la lista. */
  inboxCounts: (filters: ChatFilters) => ['chats', 'counts', filters] as const,
  /** Cuántos leads tienen mensajes sin leer (la pastilla global). */
  unreadCount: ['unread-count'] as const,
  /** Los valores de los campos personalizados de un lead. */
  customFieldValues: (leadId: string | null) => ['lead-custom-fields', leadId] as const,
  /** Las compras del lead (con qué paquete cerró). */
}

export const kanbanKeys = {
  all: ['kanban'] as const,
  snapshot: (search: string) => ['kanban', 'snapshot', search] as const,
  /** Una página de una etapa en la vista de lista. */
  stagePage: (stage: string, search: string, offset: number, limit: number) => ['kanban', 'stage', stage, search, offset, limit] as const,
}

export const stageKeys = {
  all: ['lead-stages'] as const,
  list: ['lead-stages', 'list'] as const,
  admin: ['lead-stages', 'admin'] as const,
}

/** El texto que busca una clave de `leadKeys.messageSearch`, o `null` si la
 *  clave es de otra cosa. */
export function messageSearchTerm(queryKey: readonly unknown[]): string | null {
  const [root, kind, section, search] = queryKey
  return root === 'chats' && kind === 'search' && section === 'messages' && typeof search === 'string' ? search : null
}
