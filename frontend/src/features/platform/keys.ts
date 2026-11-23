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

export const roleKeys = {
  all: ['roles'] as const,
  // Bajo `roles`: guardar la matriz reaplica los GRANT y refresca esta vista.
  dbPrivileges: ['roles', 'db-privileges'] as const,
}

export const settingsKeys = {
  all: ['settings'] as const,
  timezones: ['settings', 'timezones'] as const,
  businessHours: ['settings', 'business-hours'] as const,
  metaPublicConfig: ['platform-meta-public-config'] as const,
  googleCalendarStatus: ['settings', 'google-calendar', 'status'] as const,
  googleCalendars: ['settings', 'google-calendar', 'calendars'] as const,
  email: ['settings', 'email'] as const,
  // Bajo `settings`: guardar ajustes o conectar Google ya invalida el prefijo
  // y el checklist se pone al día sin que nadie lo recuerde.
  onboarding: ['settings', 'onboarding'] as const,
}

export const whatsappKeys = {
  status: ['whatsapp', 'status'] as const,
  callingReadiness: ['whatsapp', 'calling-readiness'] as const,
  calling: ['whatsapp', 'calling'] as const,
  costsAll: ['whatsapp', 'costs'] as const,
  costs: (month: string) => ['whatsapp', 'costs', month] as const,
  conversions: ['whatsapp', 'conversions'] as const,
  // Dentro de `conversions`: invalidar el panel también refresca el historial.
  conversionEvents: (page: number) => ['whatsapp', 'conversions', 'events', page] as const,
}

/** Panel de plataforma: su propia sesión y sus propios datos. */
export const platformKeys = {
  me: ['platform', 'me'] as const,
  organizations: ['platform', 'organizations'] as const,
  settings: ['platform', 'settings'] as const,
  email: ['platform', 'email'] as const,
  overview: (organizationId: string) => ['platform', 'organizations', organizationId, 'overview'] as const,
  dbAccess: (organizationId: string) => ['platform', 'organizations', organizationId, 'db-access'] as const,
  branding: (organizationId: string) => ['platform', 'organizations', organizationId, 'branding'] as const,
  ai: (organizationId: string) => ['platform', 'organizations', organizationId, 'ai'] as const,
  integrations: (organizationId: string) => ['platform', 'organizations', organizationId, 'integrations'] as const,
  knowledgeTemplates: ['platform', 'knowledge-templates'] as const,
}
