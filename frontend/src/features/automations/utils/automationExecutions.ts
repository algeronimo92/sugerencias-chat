import {
AUTOMATION_TRIGGERS,AutomationExecutionStatus,type AutomationExecutionStatusValue,
} from '../domain/automationCatalog'
import type { AutomationExecution, AutomationTrigger } from '../types'

/** Helpers de presentación compartidos por las vistas que listan ejecuciones
 *  de automatizaciones: el Historial de admin (AutomationsPage) y "Flujos
 *  enviados" del vendedor (MyAutomationExecutionsPage). */

export function formatExecutionDate(value: string | null) {
  return value ? new Date(value).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca'
}

export function executionTriggerLabel(value: AutomationTrigger) {
  return AUTOMATION_TRIGGERS.find(item => item.value === value)?.label ?? value
}

export function executionTone(status: string) {
  if (status === AutomationExecutionStatus.Completed) return 'bg-green-100 text-wa-primary-strong dark:bg-green-950 dark:text-green-300'
  if (status === AutomationExecutionStatus.Failed) return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
  if (status === AutomationExecutionStatus.Skipped) return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
  // Neutro: cancelar fue una decisión de alguien, no un problema que atender.
  if (status === AutomationExecutionStatus.Cancelled) return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  if (status === AutomationExecutionStatus.Paused) return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
  return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
}

export const EXECUTION_STATUS_LABELS: Record<AutomationExecutionStatusValue, string> = {
  [AutomationExecutionStatus.Scheduled]: 'Programada',
  [AutomationExecutionStatus.Running]: 'En curso',
  [AutomationExecutionStatus.Paused]: 'Pausada',
  [AutomationExecutionStatus.Completed]: 'Completada',
  [AutomationExecutionStatus.Failed]: 'Fallida',
  // Era «Omitida», que no decía por qué: son las que el motor descartó porque
  // el lead no cumplía las condiciones o el cliente respondió antes.
  [AutomationExecutionStatus.Skipped]: 'No aplicó',
  [AutomationExecutionStatus.Cancelled]: 'Cancelada',
}

export function isExecutionStatus(value: string): value is AutomationExecutionStatusValue {
  return Object.values(AutomationExecutionStatus).some(status => status === value)
}

export function executionStatusLabel(status: string) {
  return isExecutionStatus(status) ? EXECUTION_STATUS_LABELS[status] : status
}

// Un paso de una ejecución. Antes se mostraba el código en inglés ("completed").
// Los cinco últimos solo los da Probar: dicen qué pasaría, sin hacerlo.
const STEP_STATUS_LABELS: Record<string, string> = {
  [AutomationExecutionStatus.Completed]: 'Hecho',
  [AutomationExecutionStatus.Failed]: 'Falló',
  [AutomationExecutionStatus.Skipped]: 'Omitido',
  [AutomationExecutionStatus.Cancelled]: 'Cancelado',
  [AutomationExecutionStatus.Scheduled]: 'Esperando',
  [AutomationExecutionStatus.Running]: 'En curso',
  [AutomationExecutionStatus.Paused]: 'En pausa',
  matched: 'Entra al flujo',
  evaluated: 'Revisado',
  would_run: 'Se haría',
  would_wait: 'Esperaría',
  would_fail: 'Fallaría',
}

export function stepStatusLabel(status: unknown) {
  const value = String(status ?? '')
  return STEP_STATUS_LABELS[value] ?? value
}

export function executionActorLabel(execution: AutomationExecution) {
  if (execution.started_by_name) return execution.started_by_name
  if (execution.start_source === 'manual') return 'Usuario eliminado'
  if (execution.start_source === 'flow') return 'Otro flujo'
  return 'Sistema'
}

/** Texto con el que el motor guarda hoy un fallo que no tiene mensaje para
 *  personas (`INTERNAL_ERROR_MESSAGE` en el backend). */
export const INTERNAL_ERROR_MESSAGE = 'Ocurrió un error interno al ejecutar este paso. Quedó registrado para soporte.'

// Lo que dejó el motor antes de ese cambio: la clave de un KeyError de Python
// («('condition-…', <FlowHandle.YES: 'yes'>)») o una excepción de SQLAlchemy.
const TECHNICAL_ERROR = /^\(|sqlalchemy|asyncpg|Traceback|<class |<[A-Za-z]+\.[A-Z_]+: /

/** El error de una ejecución o de un paso, sin texto de programador. */
export function readableExecutionError(error: string | null | undefined): string | null {
  if (!error) return null
  return TECHNICAL_ERROR.test(error) ? INTERNAL_ERROR_MESSAGE : error
}

/** La ejecución lanzada a mano que está reteniendo a `execution`, si la hay.
 *
 *  Lo manual tiene prioridad: mientras una secuencia lanzada después por una
 *  persona sigue en marcha, el seguimiento que ya estaba esperando no retoma
 *  (misma regla que `_blocking_execution_exists` en sql_executions.py). Sin
 *  decirlo, su tarjeta mostraba «Continúa en instantes» durante horas. */
export function heldByManualFlow<T extends Pick<AutomationExecution, 'id' | 'status' | 'start_source' | 'parent_execution_id'>>(
  execution: T,
  others: readonly T[],
): T | undefined {
  if (execution.status !== AutomationExecutionStatus.Scheduled) return undefined
  return others.find(other =>
    other.id > execution.id
    && other.start_source === 'manual'
    && (other.status === AutomationExecutionStatus.Scheduled || other.status === AutomationExecutionStatus.Running)
    // Padre e hijo no se retienen entre sí.
    && other.parent_execution_id !== execution.id
    && execution.parent_execution_id !== other.id,
  )
}
