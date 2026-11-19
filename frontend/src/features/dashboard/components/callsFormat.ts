import type { DashboardCalls } from '../types'

/** Con tan pocas llamadas un porcentaje engaña: un solo fallo parece una crisis. */
export const MIN_CALLS_FOR_PERCENT = 10

export function answerRateLabel(calls: Pick<DashboardCalls, 'answer_rate' | 'inbound_answered' | 'inbound_missed'>): string {
  const offered = calls.inbound_answered + calls.inbound_missed
  if (calls.answer_rate == null || offered === 0) return '—'
  return offered < MIN_CALLS_FOR_PERCENT ? `${calls.inbound_answered} de ${offered}` : `${Math.round(calls.answer_rate * 100)}%`
}
