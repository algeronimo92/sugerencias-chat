import { useMutation, useQuery } from '@tanstack/react-query'
import client from '../api/client'
import { queryClient } from '../queryClient'
import type { AutomationAction, AutomationConditions, AutomationExecution, AutomationFlowDefinition, AutomationRule, AutomationTrigger } from '../types'

export interface AutomationRuleInput {
  name: string
  trigger_type: AutomationTrigger
  trigger_config: { minutes?: number }
  conditions: AutomationConditions
  actions: AutomationAction[]
  delay_minutes: number
  max_executions_per_hour: number | null
  is_active: boolean
}

export function useAutomationRules() {
  return useQuery({
    queryKey: ['automations'],
    queryFn: async () => (await client.get<AutomationRule[]>('/api/automations')).data,
    refetchInterval: 30_000,
  })
}

export function useAutomationExecutions(ruleId?: number, status?: string) {
  return useQuery({
    queryKey: ['automation-executions', ruleId ?? 'all', status ?? 'all'],
    queryFn: async () => (await client.get<AutomationExecution[]>('/api/automations/executions', {
      params: { rule_id: ruleId, status, limit: 200 },
    })).data,
    refetchInterval: 15_000,
  })
}

function invalidateAutomations() {
  void queryClient.invalidateQueries({ queryKey: ['automations'] })
  void queryClient.invalidateQueries({ queryKey: ['automation-executions'] })
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
