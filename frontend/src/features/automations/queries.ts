import { useMutation,useQuery } from '@tanstack/react-query'
import { useChatSocketConnected } from '../../realtime/useRealtime'
import { queryClient } from '../../shared/queryClient'
import { requestAutomationExecution,requestAutomationExecutions,requestAutomationRules,requestCancelExecution,requestCreateAutomation,requestCreateVisualFlow,requestDeleteAutomation,requestDuplicateAutomation,requestFlowVersions,requestManualFlows,requestPauseExecution,requestPublishVisualFlow,requestRestoreFlowVersion,requestResumeExecution,requestRetryExecution,requestSaveVisualFlow,requestSimulateVisualFlow,requestStartManualFlow,requestUpdateAutomation } from './api'
import type { AutomationExecutionFilters } from './types'

export type { AutomationRuleInput } from './types'

export function useAutomationRules() {
  const connected = useChatSocketConnected()
  return useQuery({
    queryKey: ['automations'],
    queryFn: requestAutomationRules(),
    refetchInterval: connected ? false : 60_000,
  })
}



// Cada cambio de estado de una ejecución emite automations_updated, que
// invalida estas queries. El poll corto es solo el respaldo con el WebSocket
// caído y un chat abierto con una ejecución en vuelo, para que el pill "Flujo
// en curso" y su botón de cancelar no queden congelados.
const ACTIVE_EXECUTION_POLL_MS = 12_000

export function useAutomationExecutions({ ruleId, chatId, status, excludeSkipped = false, active, dateFrom, dateTo, mine = false }: AutomationExecutionFilters = {}) {
  const connected = useChatSocketConnected()
  return useQuery({
    queryKey: ['automation-executions', ruleId ?? 'all', chatId ?? 'all', status ?? 'all', excludeSkipped, active ?? 'all', dateFrom ?? 'none', dateTo ?? 'none', mine],
    queryFn: requestAutomationExecutions({ ruleId, chatId, status, excludeSkipped, active, dateFrom, dateTo, mine }),
    refetchInterval: (query) => {
      if (connected) return false
      if (chatId) {
        const hasActiveExecution = query.state.data?.some(
          (execution) => execution.status === 'scheduled'
            || execution.status === 'running'
            // Una congelada no cambia sola, pero sí cuando el vendedor reanuda
            // el lead: sin el poll, el panel se quedaría mostrando "en pausa"
            // hasta el próximo evento si el WebSocket está caído.
            || execution.status === 'paused'
        )
        if (hasActiveExecution) return ACTIVE_EXECUTION_POLL_MS
        return false
      }
      return 60_000
    },
  })
}

/** Flujos visuales de trigger manual que el vendedor puede iniciar desde el
 *  chat de un lead puntual (el admin ve además los que aún no marcó visibles
 *  o publicó, para poder probarlos). chatId hoy no filtra la lista en el
 *  backend — se manda por si una futura iteración lo necesita (p. ej. ocultar
 *  un flujo ya en curso para ese chat). Sin chatId trae el catálogo completo
 *  de flujos manuales, como usa la pantalla "Flujos enviados" para el filtro
 *  por automatización. */
export function useManualFlows(chatId?: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['automation-manual-flows', chatId ?? 'all'],
    queryFn: requestManualFlows(chatId),
    enabled,
    // Catálogo que cambia solo al editar flujos, y eso llega por
    // automations_updated.
    staleTime: 5 * 60_000,
  })
}

export function useStartManualFlow() {
  return useMutation({
    mutationFn: requestStartManualFlow(),
    onSuccess: invalidateAutomations,
  })
}

function invalidateAutomations() {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['automations'] }),
    queryClient.invalidateQueries({ queryKey: ['automation-executions'] }),
  ])
}

export function useCreateAutomation() {
  return useMutation({
    mutationFn: requestCreateAutomation(),
    onSuccess: invalidateAutomations,
  })
}

export function useUpdateAutomation() {
  return useMutation({
    mutationFn: requestUpdateAutomation(),
    onSuccess: invalidateAutomations,
  })
}

export function useDuplicateAutomation() {
  return useMutation({
    mutationFn: requestDuplicateAutomation(),
    onSuccess: invalidateAutomations,
  })
}

export function useDeleteAutomation() {
  return useMutation({
    mutationFn: requestDeleteAutomation(),
    onSuccess: invalidateAutomations,
  })
}

/** Reintenta una ejecución con error. `ignoreServiceWindow` es la autorización
 *  del admin para que los envíos salgan aunque la ventana de 24 h esté
 *  cerrada; vale solo para esa ejecución y el backend registra quién la dio. */
export function useRetryExecution() {
  return useMutation({
    mutationFn: requestRetryExecution(),
    onSuccess: invalidateAutomations,
  })
}

/** Estado puntual de una ejecución por id. Se usa para saber, incluso
 *  después de recargar la página, si una autorización de ventana de 24 h
 *  ya quedó registrada — la notificación que la disparó no guarda ese dato,
 *  solo la ejecución lo tiene. */
export function useAutomationExecution(executionId: number | null) {
  return useQuery({
    queryKey: ['automation-executions', 'by-id', executionId],
    queryFn: requestAutomationExecution(executionId),
    enabled: executionId !== null,
  })
}

export function useCancelExecution() {
  return useMutation({
    mutationFn: requestCancelExecution(),
    onSuccess: invalidateAutomations,
  })
}

/** Congela una sola ejecución sin frenar el resto de lo que corre sobre el
 *  lead. A diferencia de cancelar, conserva lo que el flujo ya avanzó y el
 *  tiempo que le faltaba para su próximo paso. */
export function usePauseExecution() {
  return useMutation({
    mutationFn: requestPauseExecution(),
    onSuccess: invalidateAutomations,
  })
}

export function useResumeExecution() {
  return useMutation({
    mutationFn: requestResumeExecution(),
    onSuccess: invalidateAutomations,
  })
}

export function useCreateVisualFlow() {
  return useMutation({
    mutationFn: requestCreateVisualFlow(),
    onSuccess: invalidateAutomations,
  })
}

export function useSaveVisualFlow() {
  return useMutation({
    mutationFn: requestSaveVisualFlow(),
    onSuccess: invalidateAutomations,
  })
}

export function usePublishVisualFlow() {
  return useMutation({
    mutationFn: requestPublishVisualFlow(),
    onSuccess: invalidateAutomations,
  })
}

export type { AutomationFlowVersion } from './types'

export function useFlowVersions(ruleId: number | null) {
  return useQuery({
    queryKey: ['automation-flow-versions', ruleId],
    queryFn: requestFlowVersions(ruleId),
    enabled: ruleId != null,
  })
}

export function useRestoreFlowVersion() {
  return useMutation({
    mutationFn: requestRestoreFlowVersion(),
    onSuccess: invalidateAutomations,
  })
}

export type { AutomationFlowSimulation } from './types'

export type { AutomationFlowSimulationStep } from './types'

export function useSimulateVisualFlow() {
  return useMutation({
    mutationFn: requestSimulateVisualFlow(),
  })
}
