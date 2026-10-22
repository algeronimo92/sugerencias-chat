/**
 * Claves de caché de React Query de esta feature. Son el contrato con el que
 * otras features y el tiempo real refrescan sus datos: nadie escribe una clave
 * a mano fuera de un `keys.ts` (lo verifica src/test/architecture.test.ts).
 * Cada `all` es el prefijo de su familia: invalidarlo alcanza a todas sus
 * variantes.
 */

import type { AutomationExecutionFilters } from './types'

export const automationKeys = {
  all: ['automations'] as const,
  manualFlowsAll: ['automation-manual-flows'] as const,
  manualFlows: (chatId: string | undefined) => ['automation-manual-flows', chatId ?? 'all'] as const,
  flowVersions: (ruleId: number | null) => ['automation-flow-versions', ruleId] as const,
}

export const executionKeys = {
  all: ['automation-executions'] as const,
  list: ({ ruleId, chatId, status, excludeSkipped, active, dateFrom, dateTo, mine }: AutomationExecutionFilters) => [
    'automation-executions', ruleId ?? 'all', chatId ?? 'all', status ?? 'all', excludeSkipped, active ?? 'all',
    dateFrom ?? 'none', dateTo ?? 'none', mine,
  ] as const,
  detail: (executionId: number | null) => ['automation-executions', 'by-id', executionId] as const,
}
