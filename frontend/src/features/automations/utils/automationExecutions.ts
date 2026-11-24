import {
AUTOMATION_TRIGGERS,AutomationExecutionStatus,type AutomationExecutionStatusValue,
} from '../domain/automationCatalog'
import type { AutomationActionResult, AutomationExecution, AutomationExecutionFilters, AutomationTrigger } from '../types'

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
  if (status === AutomationExecutionStatus.Failed || status === 'undelivered') return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
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

/**
 * Lo que se le muestra a la persona de una ejecución: su estado, salvo en las
 * completadas, donde manda qué pasó con sus mensajes.
 *
 * «Completada» significaba «el flujo recorrió sus pasos», y para quien mira
 * la pantalla significa «el cliente lo recibió». Había completadas con
 * mensajes que nunca salieron y se leían igual que las demás. El estado del
 * motor no cambia (de él dependen el tope por hora y el «no repetir»); esto
 * es solo cómo se muestra y se filtra.
 */
export const ExecutionOutcome = { Sending: 'sending', Undelivered: 'undelivered' } as const
export type ExecutionOutcomeValue = AutomationExecutionStatusValue | (typeof ExecutionOutcome)[keyof typeof ExecutionOutcome]

export function executionOutcome(execution: Pick<AutomationExecution, 'status' | 'delivery_state'>): ExecutionOutcomeValue {
  if (execution.status !== AutomationExecutionStatus.Completed) return execution.status
  if (execution.delivery_state === 'failed') return ExecutionOutcome.Undelivered
  if (execution.delivery_state === 'pending') return ExecutionOutcome.Sending
  return AutomationExecutionStatus.Completed
}

/** En el orden del filtro: las tres formas de «terminó de recorrer sus pasos» juntas. */
export const EXECUTION_OUTCOME_LABELS: Record<ExecutionOutcomeValue, string> = {
  [AutomationExecutionStatus.Scheduled]: EXECUTION_STATUS_LABELS[AutomationExecutionStatus.Scheduled],
  [AutomationExecutionStatus.Running]: EXECUTION_STATUS_LABELS[AutomationExecutionStatus.Running],
  [AutomationExecutionStatus.Paused]: EXECUTION_STATUS_LABELS[AutomationExecutionStatus.Paused],
  [AutomationExecutionStatus.Completed]: EXECUTION_STATUS_LABELS[AutomationExecutionStatus.Completed],
  [ExecutionOutcome.Sending]: 'Enviando…',
  [ExecutionOutcome.Undelivered]: 'No se entregó',
  [AutomationExecutionStatus.Failed]: EXECUTION_STATUS_LABELS[AutomationExecutionStatus.Failed],
  [AutomationExecutionStatus.Skipped]: EXECUTION_STATUS_LABELS[AutomationExecutionStatus.Skipped],
  [AutomationExecutionStatus.Cancelled]: EXECUTION_STATUS_LABELS[AutomationExecutionStatus.Cancelled],
}

export function isExecutionOutcome(value: string): value is ExecutionOutcomeValue {
  return value in EXECUTION_OUTCOME_LABELS
}

/** Los filtros del backend que traen exactamente lo que esa etiqueta muestra. */
export function outcomeFilter(outcome: ExecutionOutcomeValue): Pick<AutomationExecutionFilters, 'status' | 'delivery'> {
  if (outcome === ExecutionOutcome.Undelivered) return { status: AutomationExecutionStatus.Completed, delivery: 'failed' }
  if (outcome === ExecutionOutcome.Sending) return { status: AutomationExecutionStatus.Completed, delivery: 'pending' }
  // «Completada» deja afuera las que no se entregaron: si no, el filtro
  // traería filas con otra etiqueta.
  if (outcome === AutomationExecutionStatus.Completed) return { status: outcome, delivery: 'ok' }
  return { status: outcome }
}

export function executionStatusLabel(status: string) {
  return isExecutionOutcome(status) ? EXECUTION_OUTCOME_LABELS[status] : status
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
  matched: 'Entra a la automatización',
  evaluated: 'Revisado',
  would_run: 'Se haría',
  would_wait: 'Esperaría',
  would_fail: 'Fallaría',
}

export function stepStatusLabel(status: unknown) {
  const value = String(status ?? '')
  return STEP_STATUS_LABELS[value] ?? value
}

/**
 * Quién puso en marcha una ejecución, en palabras de la dueña.
 *
 * Decía «Ejecutada por Otro flujo» o «por Sistema»: no decía cuál flujo, y en
 * DermicaPro uno de cada seis envíos lo lanza «Bienvenida». Una hija hereda el
 * `started_by` de su madre, por eso el origen `flow` se mira antes que el nombre.
 */
export function executionOriginLabel(
  execution: Pick<AutomationExecution, 'start_source' | 'started_by_name' | 'parent_rule_name'>,
) {
  if (execution.start_source === 'flow') {
    return execution.parent_rule_name ? `La lanzó «${execution.parent_rule_name}»` : 'La lanzó otra automatización'
  }
  if (execution.start_source === 'manual') {
    return `La lanzó ${execution.started_by_name ?? 'alguien que ya no está en el equipo'}`
  }
  return 'Empezó sola'
}

const RECENT_SEND_MS = 24 * 60 * 60 * 1000

/** Qué flujos ya recibió este lead en el último día y quién los lanzó. En
 *  DermicaPro la vendedora repetía a mano la secuencia que «Bienvenida»
 *  acababa de enviar: nada en el menú se lo decía. No bloquea, solo avisa:
 *  repetir puede ser a propósito. */
export function recentSends(executions: AutomationExecution[], now: number): Map<number, string> {
  const latest = new Map<number, AutomationExecution>()
  for (const execution of executions) {
    if (execution.status !== 'completed') continue
    const age = now - new Date(execution.created_at).getTime()
    if (age < 0 || age > RECENT_SEND_MS) continue
    const known = latest.get(execution.rule_id)
    if (!known || known.created_at < execution.created_at) latest.set(execution.rule_id, execution)
  }
  const notes = new Map<number, string>()
  for (const [ruleId, execution] of latest) {
    const minutes = Math.floor((now - new Date(execution.created_at).getTime()) / 60_000)
    const when = minutes < 1 ? 'hace un momento' : minutes < 60 ? `hace ${minutes} min` : `hace ${Math.floor(minutes / 60)} h`
    notes.set(ruleId, `Ya se envió ${when} · ${executionOriginLabel(execution)}`)
  }
  return notes
}

/**
 * Cómo nombrar al cliente de una ejecución. Nunca su uuid: el historial lo
 * mostraba cuando el lead no tenía nombre y nadie podía reconocerlo.
 */
export function executionLeadLabel(
  execution: Pick<AutomationExecution, 'lead_id' | 'lead_name' | 'lead_phone'>,
) {
  if (!execution.lead_id) return 'Lead eliminado'
  return execution.lead_name?.trim() || execution.lead_phone?.trim() || 'Lead sin nombre'
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

export interface StepLookups {
  stageName: (key: string) => string
  userName: (id: number) => string | undefined
  tagName: (id: number) => string | undefined
}

/**
 * Qué hizo exactamente un paso que no manda mensajes.
 *
 * El historial decía «3. Cambiar etapa · Hecho»: a cuál, había que abrir el
 * flujo para saberlo. El resultado del paso ya trae el dato; faltaba decirlo
 * con nombres en vez de ids. `null` si el paso no tiene nada que agregar.
 */
export function stepResultDetail(result: AutomationActionResult, lookups: StepLookups): string | null {
  const user = result.user_id != null ? lookups.userName(result.user_id) ?? 'alguien que ya no está en el equipo' : null
  const tag = result.tag_id != null ? `«${lookups.tagName(result.tag_id) ?? 'una etiqueta eliminada'}»` : null
  const skipped = result.status === AutomationExecutionStatus.Skipped
  switch (result.type) {
    case 'change_stage':
      return result.stage ? `A la etapa «${lookups.stageName(result.stage)}»` : null
    case 'assign_seller':
      return user ? `A ${user}` : null
    case 'notify':
      return user ? `A ${user}` : null
    case 'add_tag':
      return tag
    case 'remove_tag':
      return tag ? (skipped ? `El lead no tenía ${tag}` : tag) : null
    case 'create_task':
      return result.task_id != null ? `Tarea n.º ${result.task_id}` : null
    case 'change_service':
      return result.service ? `«${result.service}»` : 'Sin servicio'
    default:
      // Lo que el motor explicó por su cuenta al omitir un paso.
      return typeof result.detail === 'string' && result.detail ? result.detail : null
  }
}

