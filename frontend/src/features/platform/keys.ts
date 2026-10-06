/**
 * Claves de caché de React Query de esta feature. Son el contrato con el que
 * otras features y el tiempo real refrescan sus datos: nadie escribe una clave
 * a mano fuera de un `keys.ts` (lo verifica src/test/architecture.test.ts).
 * Cada `all` es el prefijo de su familia: invalidarlo alcanza a todas sus
 * variantes.
 */

export const userKeys = {
  all: ['users'] as const,
  sellers: ['sellers'] as const,
}

export const settingsKeys = {
  all: ['settings'] as const,
  timezones: ['settings', 'timezones'] as const,
  metaPublicConfig: ['platform-meta-public-config'] as const,
}

export const whatsappKeys = {
  status: ['whatsapp', 'status'] as const,
}

/** Panel de plataforma: su propia sesión y sus propios datos. */
export const platformKeys = {
  me: ['platform', 'me'] as const,
  organizations: ['platform', 'organizations'] as const,
  settings: ['platform', 'settings'] as const,
  branding: (organizationId: string) => ['platform', 'organizations', organizationId, 'branding'] as const,
  ai: (organizationId: string) => ['platform', 'organizations', organizationId, 'ai'] as const,
  integrations: (organizationId: string) => ['platform', 'organizations', organizationId, 'integrations'] as const,
}
