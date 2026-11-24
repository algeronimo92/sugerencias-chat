import { AutomationExecutionStatus, isServiceWindowFailure } from '../domain/automationCatalog'
import type { AutomationExecution } from '../types'

/** Cuánto tiempo en pausa hace falta para que una ejecución pida atención:
 *  una pausa de horas es una decisión reciente; una de semanas es un olvido
 *  (en DermicaPro había cinco congeladas desde hacía dos y tres meses). */
export const LONG_PAUSE_DAYS = 7

/** Hasta cuándo un fallo sigue pidiendo atención si nadie lo descarta: uno
 *  de hace una semana ya no se arregla reintentando. */
export const ATTENTION_WINDOW_DAYS = 3

export type AttentionCause = 'service_window' | 'undelivered' | 'no_seller' | 'failed' | 'long_pause'

export interface AttentionGroup {
  cause: AttentionCause
  title: string
  /** Qué pasó y qué se puede hacer, en palabras de la clínica. */
  hint: string
  executions: AutomationExecution[]
}

const GROUPS: Record<AttentionCause, Pick<AttentionGroup, 'title' | 'hint'>> = {
  service_window: {
    title: 'Frenadas por la ventana de 24 horas',
    hint: 'Pasaron más de 24 h desde el último mensaje del cliente y WhatsApp ya no deja escribirle libremente.',
  },
  undelivered: {
    title: 'Mensajes que no se entregaron',
    hint: 'El flujo recorrió todos sus pasos, pero WhatsApp no entregó algún mensaje. Abre el chat para ver cuál y escribirle al cliente.',
  },
  no_seller: {
    title: 'Falta una vendedora',
    hint: 'La automatización necesitaba a quién asignar la tarea o el aviso y el lead no tiene vendedora.',
  },
  failed: {
    title: 'Se cortaron por un error',
    hint: 'Un paso falló y el flujo no siguió. Reintentar retoma desde ese paso, sin repetir lo ya enviado.',
  },
  long_pause: {
    title: `En pausa hace más de ${LONG_PAUSE_DAYS} días`,
    hint: 'Alguien las pausó desde el chat y siguen esperando. Reanúdalas o cancélalas para que no queden colgadas.',
  },
}

// El orden es el de la urgencia: lo que no le llegó al cliente va primero.
const ORDER: AttentionCause[] = ['service_window', 'undelivered', 'failed', 'no_seller', 'long_pause']

// El backend solo da código propio a la ventana de 24 h; el resto de causas
// se reconoce por su texto (domain/execution.py y application/actions.py).
const NO_SELLER = /no tiene vendedor/i

function causeOf(execution: AutomationExecution, now: number): AttentionCause | null {
  // Alguien ya la vio y decidió dejarla así.
  if (execution.attention_dismissed_at) return null
  if (execution.status === AutomationExecutionStatus.Paused) {
    const pausedAt = execution.paused_at ? new Date(execution.paused_at).getTime() : null
    return pausedAt !== null && now - pausedAt > LONG_PAUSE_DAYS * 86_400_000 ? 'long_pause' : null
  }
  if (execution.status === AutomationExecutionStatus.Completed) {
    return execution.delivery_state === 'failed' ? 'undelivered' : null
  }
  if (execution.status !== AutomationExecutionStatus.Failed) return null
  // Una automatización eliminada no se puede reintentar: no hay nada que decidir.
  if (execution.rule_deleted) return null
  if (isServiceWindowFailure(execution)) return 'service_window'
  if (NO_SELLER.test(execution.error ?? '')) return 'no_seller'
  return 'failed'
}

/** Lo que no salió como debía y espera una decisión, agrupado por causa. Un
 *  grupo sin ejecuciones no se devuelve. */
export function groupAttention(executions: readonly AutomationExecution[], now: number): AttentionGroup[] {
  const byCause = new Map<AttentionCause, AutomationExecution[]>()
  for (const execution of executions) {
    const cause = causeOf(execution, now)
    if (cause) byCause.set(cause, [...(byCause.get(cause) ?? []), execution])
  }
  return ORDER.filter(cause => byCause.has(cause)).map(cause => ({ cause, ...GROUPS[cause], executions: byCause.get(cause)! }))
}

export function attentionCount(groups: readonly AttentionGroup[]): number {
  return groups.reduce((total, group) => total + group.executions.length, 0)
}
