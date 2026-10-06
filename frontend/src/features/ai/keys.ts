/**
 * Claves de caché de React Query de esta feature. Son el contrato con el que
 * otras features y el tiempo real refrescan sus datos: nadie escribe una clave
 * a mano fuera de un `keys.ts` (lo verifica src/test/architecture.test.ts).
 * Cada `all` es el prefijo de su familia: invalidarlo alcanza a todas sus
 * variantes.
 */

export const aiKeys = {
  usage: ['ai-assistant', 'usage'] as const,
  profile: ['ai-assistant', 'profile'] as const,
  knowledgeAll: ['ai-assistant', 'knowledge'] as const,
  knowledge: (documentId: string | null) => ['ai-assistant', 'knowledge', documentId] as const,
  suggestionsAll: ['suggestions'] as const,
  suggestions: (chatId: string | null) => ['suggestions', chatId] as const,
  /** Claves de mutación: la UI sabe si hay una generación en curso. */
  generating: ['generate-suggestions'] as const,
  analyzing: ['analyze-lead'] as const,
}
