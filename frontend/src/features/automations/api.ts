import type { AutomationExecutionFilters } from './types'
import client from "../../shared/http/client";
import type { AutomationExecution,AutomationFlowDefinition,AutomationFlowSimulation,AutomationFlowVersion,AutomationRule,AutomationRuleInput } from "./types";

export async function fetchAutomationRules() {
  return (await client.get<AutomationRule[]>('/api/automations')).data
}

export async function fetchAutomationExecutions({ ruleId, chatId, status, excludeSkipped, active, dateFrom, dateTo, mine }: AutomationExecutionFilters) {
  return (await client.get<AutomationExecution[]>('/api/automations/executions', {
      params: {
        rule_id: ruleId, chat_id: chatId, status, exclude_skipped: excludeSkipped, active,
        date_from: dateFrom, date_to: dateTo, mine, limit: 200,
      },
    })).data
}

export async function fetchManualFlows(chatId: string | undefined) {
  return (await client.get<AutomationRule[]>('/api/automations/manual', {
      params: { chat_id: chatId },
    })).data
}

export async function startManualFlow({ ruleId, chatId }: { ruleId: number; chatId: string }) {
  return (await client.post<AutomationExecution>(`/api/automations/${ruleId}/start`, { chat_id: chatId })).data
}

export async function createAutomation(input: AutomationRuleInput) {
  return (await client.post<AutomationRule>('/api/automations', input)).data
}

export async function updateAutomation({ id, ...values }: Partial<AutomationRuleInput> & { id: number }) {
  return (await client.patch<AutomationRule>(`/api/automations/${id}`, values)).data
}

export async function duplicateAutomation(id: number) {
  return (await client.post<AutomationRule>(`/api/automations/${id}/duplicate`)).data
}

export async function deleteAutomation(id: number) { await client.delete(`/api/automations/${id}`) }

export async function retryExecution({ id, ignoreServiceWindow = false }: { id: number; ignoreServiceWindow?: boolean }) {
  return (await client.post<AutomationExecution>(
        `/api/automations/executions/${id}/retry`,
        { ignore_service_window: ignoreServiceWindow },
      )).data
}

export async function fetchAutomationExecution(executionId: number | null) {
  return (await client.get<AutomationExecution>(`/api/automations/executions/${executionId}`)).data
}

export async function cancelExecution(id: number) {
  return (await client.post<AutomationExecution>(`/api/automations/executions/${id}/cancel`)).data
}

export async function pauseExecution(id: number) {
  return (await client.post<AutomationExecution>(`/api/automations/executions/${id}/pause`)).data
}

export async function resumeExecution(id: number) {
  return (await client.post<AutomationExecution>(`/api/automations/executions/${id}/resume`)).data
}

export async function createVisualFlow(input: { name: string; flow_definition: AutomationFlowDefinition }) {
  return (await client.post<AutomationRule>('/api/automations/flows', input)).data
}

export async function saveVisualFlow({ id, ...input }: { id: number; name: string; flow_definition: AutomationFlowDefinition }) {
  return (await client.patch<AutomationRule>(`/api/automations/${id}/flow`, input)).data
}

export async function publishVisualFlow(id: number) {
  return (await client.post<AutomationRule>(`/api/automations/${id}/publish`)).data
}

export async function fetchFlowVersions(ruleId: number | null) {
  return (await client.get<AutomationFlowVersion[]>(`/api/automations/${ruleId}/versions`)).data
}

export async function restoreFlowVersion({ id, version }: { id: number; version: number }) {
  return (await client.post<AutomationRule>(`/api/automations/${id}/versions/${version}/restore`)).data
}

export async function simulateVisualFlow({ id, leadId }: { id: number; leadId: string }) {
  return (await client.post<AutomationFlowSimulation>(`/api/automations/${id}/simulate`, { lead_id: leadId })).data
}
