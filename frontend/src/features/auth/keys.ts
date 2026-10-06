/**
 * Claves de caché de React Query de esta feature. Son el contrato con el que
 * otras features y el tiempo real refrescan sus datos: nadie escribe una clave
 * a mano fuera de un `keys.ts` (lo verifica src/test/architecture.test.ts).
 * Cada `all` es el prefijo de su familia: invalidarlo alcanza a todas sus
 * variantes.
 */

import { ME_QUERY_KEY } from '../../shared/queryClient'

export const authKeys = {
  /** La sesión: la lee la guarda de la app (shared/auth) con la misma clave. */
  me: ME_QUERY_KEY,
  pinStatus: ['auth', 'pin-status'] as const,
  sessions: ['auth', 'sessions'] as const,
  mfaStatus: ['auth', 'mfa-status'] as const,
  actionToken: (token: string) => ['auth', 'action-token', token] as const,
}
