import type { AutomationExecutionFilters } from './types'
import client from "../../shared/http/client";
import { jsonAs, type ApiResponse } from '../../shared/http/contract'
import type { AutomationAction, AutomationActionResult, AutomationConditions, AutomationExecution, AutomationFlowDefinition, ContractAutomationExecution, ContractAutomationRule, AutomationFlowSimulation, AutomationFlowSimulationStep, AutomationFlowVersion, AutomationRule, AutomationRuleInput } from "./types";

/** De lo que entrega el contrato a la regla que usan las pantallas. */
export function toAutomationRule(rule: ContractAutomationRule): AutomationRule {
  return {
    ...rule,
    trigger_config: jsonAs<AutomationRule['trigger_config']>(rule.trigger_config),
    conditions: jsonAs<AutomationConditions>(rule.conditions),
    actions: rule.actions.map(action => jsonAs<AutomationAction>(action)),
    flow_definition: jsonAs<AutomationRule['flow_definition']>(rule.flow_definition),
    published_flow_definition: rule.published_flow_definition === null ? null : jsonAs<AutomationFlowDefinition>(rule.published_flow_definition),
  }
}

/** De lo que entrega el contrato a la ejecución que usan las pantallas. */
export function toAutomationExecution(execution: ContractAutomationExecution): AutomationExecution {
  return {
    ...execution,
    action_results: execution.action_results.map(result => jsonAs<AutomationActionResult>(result)),
    flow_state: jsonAs<AutomationExecution['flow_state']>(execution.flow_state),
  }
}

export async function fetchAutomationRules(): Promise<AutomationRule[]> {
  const { data } = await client.get<ApiResponse<'/api/automations', 'get'>>('/api/automations')
  return data.map(toAutomationRule)
}

export async function fetchAutomationExecutions({ ruleId, chatId, status, excludeSkipped, active, dateFrom, dateTo, mine }: AutomationExecutionFilters): Promise<AutomationExecution[]> {
  const { data } = await client.get<ApiResponse<'/api/automations/executions', 'get'>>('/api/automations/executions', {
      params: {
        rule_id: ruleId, chat_id: chatId, status, exclude_skipped: excludeSkipped, active,
        date_from: dateFrom, date_to: dateTo, mine, limit: 200,
      },
    })
  return data.map(toAutomationExecution)
}

export async function fetchManualFlows(chatId: string | undefined): Promise<AutomationRule[]> {
  const { data } = await client.get<ApiResponse<'/api/automations/manual', 'get'>>('/api/automations/manual', {
      params: { chat_id: chatId },
    })
  return data.map(toAutomationRule)
}

export async function startManualFlow({ ruleId, chatId }: { ruleId: number; chatId: string }): Promise<AutomationExecution> {
  const { data } = await client.post<ApiResponse<'/api/automations/{rule_id}/start', 'post'>>(`/api/automations/${ruleId}/start`, { chat_id: chatId })
  return toAutomationExecution(data)
}

export async function createAutomation(input: AutomationRuleInput): Promise<AutomationRule> {
  const { data } = await client.post<ApiResponse<'/api/automations', 'post'>>('/api/automations', input)
  return toAutomationRule(data)
}

export async function updateAutomation({ id, ...values }: Partial<AutomationRuleInput> & { id: number }): Promise<AutomationRule> {
  const { data } = await client.patch<ApiResponse<'/api/automations/{rule_id}', 'patch'>>(`/api/automations/${id}`, values)
  return toAutomationRule(data)
}

export async function duplicateAutomation(id: number): Promise<AutomationRule> {
  const { data } = await client.post<ApiResponse<'/api/automations/{rule_id}/duplicate', 'post'>>(`/api/automations/${id}/duplicate`)
  return toAutomationRule(data)
}

export async function deleteAutomation(id: number) { await client.delete<ApiResponse<'/api/automations/{rule_id}', 'delete'>>(`/api/automations/${id}`) }

export async function retryExecution({ id, ignoreServiceWindow = false }: { id: number; ignoreServiceWindow?: boolean }): Promise<AutomationExecution> {
  const { data } = await client.post<ApiResponse<'/api/automations/executions/{execution_id}/retry', 'post'>>(
        `/api/automations/executions/${id}/retry`,
        { ignore_service_window: ignoreServiceWindow },
      )
  return toAutomationExecution(data)
}

export async function fetchAutomationExecution(executionId: number | null): Promise<AutomationExecution> {
  const { data } = await client.get<ApiResponse<'/api/automations/executions/{execution_id}', 'get'>>(`/api/automations/executions/${executionId}`)
  return toAutomationExecution(data)
}

export async function cancelExecution(id: number): Promise<AutomationExecution> {
  const { data } = await client.post<ApiResponse<'/api/automations/executions/{execution_id}/cancel', 'post'>>(`/api/automations/executions/${id}/cancel`)
  return toAutomationExecution(data)
}

export async function pauseExecution(id: number): Promise<AutomationExecution> {
  const { data } = await client.post<ApiResponse<'/api/automations/executions/{execution_id}/pause', 'post'>>(`/api/automations/executions/${id}/pause`)
  return toAutomationExecution(data)
}

export async function resumeExecution(id: number): Promise<AutomationExecution> {
  const { data } = await client.post<ApiResponse<'/api/automations/executions/{execution_id}/resume', 'post'>>(`/api/automations/executions/${id}/resume`)
  return toAutomationExecution(data)
}

export async function createVisualFlow(input: { name: string; flow_definition: AutomationFlowDefinition }): Promise<AutomationRule> {
  const { data } = await client.post<ApiResponse<'/api/automations/flows', 'post'>>('/api/automations/flows', input)
  return toAutomationRule(data)
}

export async function saveVisualFlow({ id, ...input }: { id: number; name: string; flow_definition: AutomationFlowDefinition }): Promise<AutomationRule> {
  const { data } = await client.patch<ApiResponse<'/api/automations/{rule_id}/flow', 'patch'>>(`/api/automations/${id}/flow`, input)
  return toAutomationRule(data)
}

export async function publishVisualFlow(id: number): Promise<AutomationRule> {
  const { data } = await client.post<ApiResponse<'/api/automations/{rule_id}/publish', 'post'>>(`/api/automations/${id}/publish`)
  return toAutomationRule(data)
}

export async function fetchFlowVersions(ruleId: number | null): Promise<AutomationFlowVersion[]> {
  return (await client.get<ApiResponse<'/api/automations/{rule_id}/versions', 'get'>>(`/api/automations/${ruleId}/versions`)).data
}

export async function restoreFlowVersion({ id, version }: { id: number; version: number }): Promise<AutomationRule> {
  const { data } = await client.post<ApiResponse<'/api/automations/{rule_id}/versions/{version}/restore', 'post'>>(`/api/automations/${id}/versions/${version}/restore`)
  return toAutomationRule(data)
}

export async function simulateVisualFlow({ id, leadId }: { id: number; leadId: string }): Promise<AutomationFlowSimulation> {
  const { data } = await client.post<ApiResponse<'/api/automations/{rule_id}/simulate', 'post'>>(`/api/automations/${id}/simulate`, { lead_id: leadId })
  return { ...data, path: data.path.map(step => jsonAs<AutomationFlowSimulationStep>(step)) }
}
