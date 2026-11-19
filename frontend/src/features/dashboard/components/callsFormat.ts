import type { DashboardCalls } from '../types'

/** Con tan pocas llamadas un porcentaje engaña: un solo fallo parece una crisis. */
export const MIN_CALLS_FOR_PERCENT = 10

/** Por debajo de esto, WhatsApp puede ocultar el botón de llamar. Meta no
 *  publica su umbral: este es propio, para avisar con margen. */
export const LOW_ANSWER_RATE = 0.7

export function isAnswerRateLow(calls: Pick<DashboardCalls, 'answer_rate' | 'inbound_answered' | 'inbound_missed'>): boolean {
  const offered = calls.inbound_answered + calls.inbound_missed
  return calls.answer_rate != null && offered >= MIN_CALLS_FOR_PERCENT && calls.answer_rate < LOW_ANSWER_RATE
}

/** "Antes 60%": la tasa del período anterior, cuando hay con qué comparar. */
export function previousRateLabel(calls: Pick<DashboardCalls, 'previous_answer_rate'>): string | null {
  return calls.previous_answer_rate == null ? null : `Período anterior: ${Math.round(calls.previous_answer_rate * 100)}%`
}

export function answerRateLabel(calls: Pick<DashboardCalls, 'answer_rate' | 'inbound_answered' | 'inbound_missed'>): string {
  const offered = calls.inbound_answered + calls.inbound_missed
  if (calls.answer_rate == null || offered === 0) return '—'
  return offered < MIN_CALLS_FOR_PERCENT ? `${calls.inbound_answered} de ${offered}` : `${Math.round(calls.answer_rate * 100)}%`
}
