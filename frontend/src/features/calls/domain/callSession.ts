/**
 * La llamada en curso en esta pestaña, como máquina de estados pura
 * (docs/analisis/17-plan-llamadas-whatsapp.md, fase 2). El audio y la red
 * viven en el proveedor; acá solo se decide en qué momento está la llamada y
 * qué se le dice a la persona.
 */

export type EndReason =
  | 'hung_up'            // colgó quien atendía
  | 'remote_ended'       // colgó el cliente
  | 'taken'              // la atendió otra persona
  | 'microphone_blocked'
  | 'no_audio'
  | 'dropped'
  | 'rejected'           // Meta no dejó atender
  | 'not_allowed'        // Meta no dejó llamar (sin permiso, límite...)
  | 'customer_rejected'
  | 'customer_no_answer'

export interface SessionCall {
  id: number
  chatId: string
  callerName: string | null
}

export type CallSession =
  | { phase: 'idle' }
  | { phase: 'connecting'; call: SessionCall; outbound: boolean }
  | { phase: 'active'; call: SessionCall; startedAt: number; muted: boolean; unstable: boolean }
  | { phase: 'ended'; call: SessionCall; reason: EndReason; durationSeconds: number | null }

export type SessionAction =
  | { type: 'answer'; call: SessionCall; outbound?: boolean }
  | { type: 'placed'; callId: number }
  | { type: 'connected'; at: number }
  | { type: 'mute'; muted: boolean }
  | { type: 'unstable'; unstable: boolean }
  | { type: 'end'; reason: EndReason; at: number }
  | { type: 'clear' }

export const IDLE: CallSession = { phase: 'idle' }

export function reduceSession(state: CallSession, action: SessionAction): CallSession {
  switch (action.type) {
    case 'answer':
      // Una sola llamada a la vez: atender otra con una en curso no hace nada.
      return state.phase === 'idle' || state.phase === 'ended'
        ? { phase: 'connecting', call: action.call, outbound: Boolean(action.outbound) }
        : state
    case 'placed':
      // El backend ya le dio id a la llamada que este navegador inició.
      return state.phase === 'connecting' && state.outbound ? { ...state, call: { ...state.call, id: action.callId } } : state
    case 'connected':
      return state.phase === 'connecting'
        ? { phase: 'active', call: state.call, startedAt: action.at, muted: false, unstable: false }
        : state
    case 'mute':
      return state.phase === 'active' ? { ...state, muted: action.muted } : state
    case 'unstable':
      return state.phase === 'active' ? { ...state, unstable: action.unstable } : state
    case 'end':
      if (state.phase === 'connecting') return { phase: 'ended', call: state.call, reason: action.reason, durationSeconds: null }
      if (state.phase === 'active') {
        return {
          phase: 'ended', call: state.call, reason: action.reason,
          durationSeconds: Math.max(0, Math.round((action.at - state.startedAt) / 1000)),
        }
      }
      return state
    case 'clear':
      return state.phase === 'ended' ? IDLE : state
  }
}

/** Lo que el navegador le informa al backend al colgar, de su lista cerrada. */
export function browserCause(reason: EndReason): string | null {
  return reason === 'microphone_blocked' || reason === 'no_audio' || reason === 'dropped' ? reason : null
}

const END_MESSAGES: Record<EndReason, string> = {
  hung_up: 'Llamada terminada',
  remote_ended: 'El cliente colgó',
  taken: 'La atendió otra persona',
  microphone_blocked: 'El navegador no tiene permiso para usar el micrófono',
  no_audio: 'No se pudo conectar el audio. Puede ser la red',
  dropped: 'Se cortó la llamada',
  rejected: 'No se pudo atender: puede que el cliente ya haya colgado',
  not_allowed: 'No se pudo llamar',
  customer_rejected: 'El cliente rechazó la llamada',
  customer_no_answer: 'El cliente no contestó',
}

export function endMessage(reason: EndReason, durationSeconds: number | null): string {
  const base = END_MESSAGES[reason]
  return durationSeconds && (reason === 'hung_up' || reason === 'remote_ended')
    ? `${base} · ${formatDuration(durationSeconds)}`
    : base
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
