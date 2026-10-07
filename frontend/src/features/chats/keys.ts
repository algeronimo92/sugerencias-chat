/**
 * Claves de caché de React Query de esta feature. Son el contrato con el que
 * otras features y el tiempo real refrescan sus datos: nadie escribe una clave
 * a mano fuera de un `keys.ts` (lo verifica src/test/architecture.test.ts).
 * Cada `all` es el prefijo de su familia: invalidarlo alcanza a todas sus
 * variantes.
 */

import type { ChatFilters } from './types'

export const chatKeys = {
  all: ['chats'] as const,
  lists: ['chats', 'list'] as const,
  list: (search: string, filters: ChatFilters) => ['chats', 'list', search, filters] as const,
  detailAll: ['chat'] as const,
  detail: (chatId: string | null) => ['chat', chatId] as const,
  unreadCount: ['unread-count'] as const,
  phoneConfig: ['phone-config'] as const,
  duplicate: (digits: string | null) => ['duplicate-lead', digits] as const,
}

export const messageKeys = {
  all: ['messages'] as const,
  thread: (chatId: string | null) => ['messages', chatId] as const,
  /** Clave de mutación de los envíos de un chat: mientras haya uno en vuelo, el
   * tiempo real no refetchea el hilo (lo resuelve el envío). */
  sending: (chatId: string | null) => ['send-message', chatId] as const,
  pinned: (chatId: string | null) => ['pinned-messages', chatId] as const,
  serviceWindowAll: ['customer-service-window'] as const,
  serviceWindow: (chatId: string | null) => ['customer-service-window', chatId] as const,
}

export const noteKeys = {
  chat: (chatId: string | null) => ['internal-notes', chatId] as const,
}

export const scheduledKeys = {
  all: ['scheduled-messages'] as const,
  chat: (chatId: string | null) => ['scheduled-messages', chatId] as const,
}
