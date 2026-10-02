import type { AutomationExecutionFilters } from './types'
import client from "../../shared/http/client";
import type { AutomationExecution,AutomationFlowDefinition,AutomationFlowSimulation,AutomationFlowVersion,AutomationRule,AutomationRuleInput } from "./types";

export function requestAutomationRules() {
  return async () => (await client.get<AutomationRule[]>('/api/automations')).data
}

export function requestAutomationExecutions({ ruleId, chatId, status, excludeSkipped, active, dateFrom, dateTo, mine }: AutomationExecutionFilters) {
  return async () => (await client.get<AutomationExecution[]>('/api/automations/executions', {
      params: {
        rule_id: ruleId, chat_id: chatId, status, exclude_skipped: excludeSkipped, active,
        date_from: dateFrom, date_to: dateTo, mine, limit: 200,
      },
    })).data
}

export function requestManualFlows(chatId: string | undefined) {
  return async () => (await client.get<AutomationRule[]>('/api/automations/manual', {
      params: { chat_id: chatId },
    })).data
}

export function requestStartManualFlow() {
  return async ({ ruleId, chatId }: { ruleId: number; chatId: string }) =>
      (await client.post<AutomationExecution>(`/api/automations/${ruleId}/start`, { chat_id: chatId })).data
}

export function requestCreateAutomation() {
  return async (input: AutomationRuleInput) => (await client.post<AutomationRule>('/api/automations', input)).data
}

export function requestUpdateAutomation() {
  return async ({ id, ...values }: Partial<AutomationRuleInput> & { id: number }) =>
      (await client.patch<AutomationRule>(`/api/automations/${id}`, values)).data
}

export function requestDuplicateAutomation() {
  return async (id: number) => (await client.post<AutomationRule>(`/api/automations/${id}/duplicate`)).data
}

export function requestDeleteAutomation() {
  return async (id: number) => { await client.delete(`/api/automations/${id}`) }
}

export function requestRetryExecution() {
  return async ({ id, ignoreServiceWindow = false }: { id: number; ignoreServiceWindow?: boolean }) =>
      (await client.post<AutomationExecution>(
        `/api/automations/executions/${id}/retry`,
        { ignore_service_window: ignoreServiceWindow },
      )).data
}

export function requestAutomationExecution(executionId: number | null) {
  return async () => (await client.get<AutomationExecution>(`/api/automations/executions/${executionId}`)).data
}

export function requestCancelExecution() {
  return async (id: number) => (await client.post<AutomationExecution>(`/api/automations/executions/${id}/cancel`)).data
}

export function requestPauseExecution() {
  return async (id: number) => (await client.post<AutomationExecution>(`/api/automations/executions/${id}/pause`)).data
}

export function requestResumeExecution() {
  return async (id: number) => (await client.post<AutomationExecution>(`/api/automations/executions/${id}/resume`)).data
}

export function requestCreateVisualFlow() {
  return async (input: { name: string; flow_definition: AutomationFlowDefinition }) =>
      (await client.post<AutomationRule>('/api/automations/flows', input)).data
}

export function requestSaveVisualFlow() {
  return async ({ id, ...input }: { id: number; name: string; flow_definition: AutomationFlowDefinition }) =>
      (await client.patch<AutomationRule>(`/api/automations/${id}/flow`, input)).data
}

export function requestPublishVisualFlow() {
  return async (id: number) => (await client.post<AutomationRule>(`/api/automations/${id}/publish`)).data
}

export function requestFlowVersions(ruleId: number | null) {
  return async () => (await client.get<AutomationFlowVersion[]>(`/api/automations/${ruleId}/versions`)).data
}

export function requestRestoreFlowVersion() {
  return async ({ id, version }: { id: number; version: number }) =>
      (await client.post<AutomationRule>(`/api/automations/${id}/versions/${version}/restore`)).data
}

export function requestSimulateVisualFlow() {
  return async ({ id, leadId }: { id: number; leadId: string }) =>
      (await client.post<AutomationFlowSimulation>(`/api/automations/${id}/simulate`, { lead_id: leadId })).data
}
