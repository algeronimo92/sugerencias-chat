/**
 * Claves de caché de React Query de los catálogos (etiquetas, servicios y
 * campos personalizados). Nadie escribe una clave a mano fuera de un `keys.ts`.
 */

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
}
