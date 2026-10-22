/**
 * Claves de caché de React Query de esta feature. Son el contrato con el que
 * otras features y el tiempo real refrescan sus datos: nadie escribe una clave
 * a mano fuera de un `keys.ts` (lo verifica src/test/architecture.test.ts).
 * Cada `all` es el prefijo de su familia: invalidarlo alcanza a todas sus
 * variantes.
 */

export const issueReportKeys = {
  all: ['issue-reports'] as const,
  list: (status: string, priority: string) => ['issue-reports', status, priority] as const,
  detail: (reportId: number | null) => ['issue-reports', 'detail', reportId] as const,
}
