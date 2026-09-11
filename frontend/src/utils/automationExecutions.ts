import type { AutomationExecution, AutomationTrigger } from '../types'
import {
  AUTOMATION_TRIGGERS, AutomationExecutionStatus, type AutomationExecutionStatusValue,
} from '../domain/automationCatalog'

/** Helpers de presentación compartidos por las vistas que listan ejecuciones
 *  de automatizaciones: el Historial de admin (AutomationsPage) y "Flujos
 *  enviados" del vendedor (MyAutomationExecutionsPage). */

export function formatExecutionDate(value: string | null) {
  return value ? new Date(value).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca'
}

export function todayISODate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function executionTriggerLabel(value: AutomationTrigger) {
  return AUTOMATION_TRIGGERS.find(item => item.value === value)?.label ?? value
}

export function executionTone(status: string) {
  if (status === AutomationExecutionStatus.Completed) return 'bg-green-100 text-wa-primary-strong dark:bg-green-950 dark:text-green-300'
  if (status === AutomationExecutionStatus.Failed) return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
  if (status === AutomationExecutionStatus.Skipped) return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
  if (status === AutomationExecutionStatus.Paused) return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
  return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
}

export const EXECUTION_STATUS_LABELS: Record<AutomationExecutionStatusValue, string> = {
  [AutomationExecutionStatus.Scheduled]: 'Programada',
  [AutomationExecutionStatus.Running]: 'En curso',
  [AutomationExecutionStatus.Paused]: 'Pausada',
  [AutomationExecutionStatus.Completed]: 'Completada',
  [AutomationExecutionStatus.Failed]: 'Fallida',
  [AutomationExecutionStatus.Skipped]: 'Omitida',
}

export function isExecutionStatus(value: string): value is AutomationExecutionStatusValue {
  return Object.values(AutomationExecutionStatus).some(status => status === value)
}

export function executionStatusLabel(status: string) {
  return isExecutionStatus(status) ? EXECUTION_STATUS_LABELS[status] : status
}

export function executionActorLabel(execution: AutomationExecution) {
  if (execution.started_by_name) return execution.started_by_name
  if (execution.start_source === 'manual') return 'Usuario eliminado'
  if (execution.start_source === 'flow') return 'Otro flujo'
  return 'Sistema'
}
