import { useMutation, useQuery } from '@tanstack/react-query'
import client from '../api/client'
import { queryClient } from '../queryClient'
import type { AutomationAction, AutomationConditions, AutomationExecution, AutomationFlowDefinition, AutomationRule, AutomationTrigger } from '../types'
import type { AutomationExecutionStatusValue } from '../domain/automationCatalog'
import { useChatSocketConnected } from './useChats'

export interface AutomationRuleInput {
  name: string
  trigger_type: AutomationTrigger
  trigger_config: { minutes?: number }
  conditions: AutomationConditions
  actions: AutomationAction[]
  delay_minutes: number
  max_executions_per_hour: number | null
  is_active: boolean
  visible_to_sellers: boolean
}

export function useAutomationRules() {
  const connected = useChatSocketConnected()
  return useQuery({
    queryKey: ['automations'],
    queryFn: async () => (await client.get<AutomationRule[]>('/api/automations')).data,
    refetchInterval: connected ? false : 60_000,
  })
}

interface AutomationExecutionFilters {
  ruleId?: number
  /** Acota el historial a un chat puntual. Es obligatorio para vendedores
   *  (el backend rechaza la consulta sin admin + sin chatId): es lo que usa
   *  el pill "Flujo en curso" dentro del chat. */
  chatId?: string
  status?: AutomationExecutionStatusValue
  excludeSkipped?: boolean
}

// No hay evento de WebSocket dedicado a cambios de automation_executions: con
// un chat abierto se hace poll corto mientras haya una ejecución manual en
// vuelo, para que el pill "Flujo en curso" y su botón de cancelar reflejen el
// avance sin que el vendedor tenga que recargar.
const ACTIVE_EXECUTION_POLL_MS = 12_000

export function useAutomationExecutions({ ruleId, chatId, status, excludeSkipped = false }: AutomationExecutionFilters = {}) {
  const connected = useChatSocketConnected()
  return useQuery({
    queryKey: ['automation-executions', ruleId ?? 'all', chatId ?? 'all', status ?? 'all', excludeSkipped],
    queryFn: async () => (await client.get<AutomationExecution[]>('/api/automations/executions', {
      params: { rule_id: ruleId, chat_id: chatId, status, exclude_skipped: excludeSkipped, limit: 200 },
    })).data,
    refetchInterval: (query) => {
      if (chatId) {
        const hasActiveExecution = query.state.data?.some(
          (execution) => execution.status === 'scheduled' || execution.status === 'running'
        )
        if (hasActiveExecution) return ACTIVE_EXECUTION_POLL_MS
        return false
      }
      return connected ? false : 60_000
    },
  })
}

/** Flujos visuales de trigger manual que el vendedor puede iniciar desde el
 *  chat de un lead puntual (el admin ve además los que aún no marcó visibles
 *  o publicó, para poder probarlos). chatId hoy no filtra la lista en el
 *  backend — se manda por si una futura iteración lo necesita (p. ej. ocultar
 *  un flujo ya en curso para ese chat). */
export function useManualFlows(chatId: string) {
  return useQuery({
    queryKey: ['automation-manual-flows', chatId],
    queryFn: async () => (await client.get<AutomationRule[]>('/api/automations/manual', {
      params: { chat_id: chatId },
    })).data,
    enabled: !!chatId,
  })
}

export function useStartManualFlow() {
  return useMutation({
    mutationFn: async ({ ruleId, chatId }: { ruleId: number; chatId: string }) =>
      (await client.post<AutomationExecution>(`/api/automations/${ruleId}/start`, { chat_id: chatId })).data,
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
    mutationFn: async (input: AutomationRuleInput) => (await client.post<AutomationRule>('/api/automations', input)).data,
    onSuccess: invalidateAutomations,
  })
}

export function useUpdateAutomation() {
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<AutomationRuleInput> & { id: number }) =>
      (await client.patch<AutomationRule>(`/api/automations/${id}`, values)).data,
    onSuccess: invalidateAutomations,
  })
}

export function useDuplicateAutomation() {
  return useMutation({
    mutationFn: async (id: number) => (await client.post<AutomationRule>(`/api/automations/${id}/duplicate`)).data,
    onSuccess: invalidateAutomations,
  })
}

export function useDeleteAutomation() {
  return useMutation({
    mutationFn: async (id: number) => { await client.delete(`/api/automations/${id}`) },
    onSuccess: invalidateAutomations,
  })
}

export function useRetryExecution() {
  return useMutation({
    mutationFn: async (id: number) => (await client.post<AutomationExecution>(`/api/automations/executions/${id}/retry`)).data,
    onSuccess: invalidateAutomations,
  })
}

export function useCancelExecution() {
  return useMutation({
    mutationFn: async (id: number) => (await client.post<AutomationExecution>(`/api/automations/executions/${id}/cancel`)).data,
    onSuccess: invalidateAutomations,
  })
}

export function useCreateVisualFlow() {
  return useMutation({
    mutationFn: async (input: { name: string; flow_definition: AutomationFlowDefinition }) =>
      (await client.post<AutomationRule>('/api/automations/flows', input)).data,
    onSuccess: invalidateAutomations,
  })
}

export function useSaveVisualFlow() {
  return useMutation({
    mutationFn: async ({ id, ...input }: { id: number; name: string; flow_definition: AutomationFlowDefinition }) =>
      (await client.patch<AutomationRule>(`/api/automations/${id}/flow`, input)).data,
    onSuccess: invalidateAutomations,
  })
}

export function usePublishVisualFlow() {
  return useMutation({
    mutationFn: async (id: number) => (await client.post<AutomationRule>(`/api/automations/${id}/publish`)).data,
    onSuccess: invalidateAutomations,
  })
}

export interface AutomationFlowVersion {
  version: number
  created_at: string
  node_count: number
  edge_count: number
  is_current: boolean
}

export function useFlowVersions(ruleId: number | null) {
  return useQuery({
    queryKey: ['automation-flow-versions', ruleId],
    queryFn: async () => (await client.get<AutomationFlowVersion[]>(`/api/automations/${ruleId}/versions`)).data,
    enabled: ruleId != null,
  })
}

export function useRestoreFlowVersion() {
  return useMutation({
    mutationFn: async ({ id, version }: { id: number; version: number }) =>
      (await client.post<AutomationRule>(`/api/automations/${id}/versions/${version}/restore`)).data,
    onSuccess: invalidateAutomations,
  })
}

export interface AutomationFlowSimulation {
  lead_id: string
  lead_name: string | null
  flow_version: number
  path: Array<Record<string, unknown>>
}

export function useSimulateVisualFlow() {
  return useMutation({
    mutationFn: async ({ id, leadId }: { id: number; leadId: string }) =>
      (await client.post<AutomationFlowSimulation>(`/api/automations/${id}/simulate`, { lead_id: leadId })).data,
  })
}
