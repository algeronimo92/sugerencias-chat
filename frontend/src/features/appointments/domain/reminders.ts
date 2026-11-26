import type { ReminderLogItem } from '../types'
import type { NoticeTone } from './noticeStatus'

export type OffsetUnit = 'minutes' | 'hours' | 'days'

const UNIT_MINUTES: Record<OffsetUnit, number> = { minutes: 1, hours: 60, days: 24 * 60 }

export const MIN_OFFSET_MINUTES = 15
export const MAX_OFFSET_MINUTES = 7 * 24 * 60
export const MAX_REMINDERS = 5

/** La anticipación como se edita: "1 día", "5 horas", "90 minutos". Se
 *  elige la unidad más grande que la expresa sin decimales. */
export function splitOffset(minutes: number): { amount: number; unit: OffsetUnit } {
  if (minutes % UNIT_MINUTES.days === 0) return { amount: minutes / UNIT_MINUTES.days, unit: 'days' }
  if (minutes % UNIT_MINUTES.hours === 0) return { amount: minutes / UNIT_MINUTES.hours, unit: 'hours' }
  return { amount: minutes, unit: 'minutes' }
}

export function joinOffset(amount: number, unit: OffsetUnit): number {
  return Math.round(amount * UNIT_MINUTES[unit])
}

/** Igual que el backend: "1 día", "5 horas", "1 hora y 30 minutos". */
export function describeOffset(minutes: number): string {
  const days = Math.floor(minutes / UNIT_MINUTES.days)
  const hours = Math.floor((minutes % UNIT_MINUTES.days) / 60)
  const rest = minutes % 60
  const parts = [
    days ? `${days} día${days === 1 ? '' : 's'}` : '',
    hours ? `${hours} hora${hours === 1 ? '' : 's'}` : '',
    rest ? `${rest} minuto${rest === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  if (parts.length === 0) return '0 minutos'
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
}

/** El error de la anticipación, o null si se puede guardar. */
export function offsetError(minutes: number, others: number[]): string | null {
  if (!Number.isFinite(minutes) || minutes < MIN_OFFSET_MINUTES || minutes > MAX_OFFSET_MINUTES) {
    return 'Entre 15 minutos y 7 días antes'
  }
  if (others.includes(minutes)) return 'Ya hay un recordatorio con esa anticipación'
  return null
}

/** La anticipación que sigue al agregar uno: la primera de las habituales
 *  que no está, o media hora menos que la más corta. */
export function nextOffset(used: number[]): number {
  const free = [24 * 60, 5 * 60, 60, 2 * 24 * 60, 30].find(value => !used.includes(value))
  return free ?? Math.max(MIN_OFFSET_MINUTES, Math.min(...used) - 30)
}

/** Cómo se lee un recordatorio en el historial: lo último que se sabe. */
export function reminderState(item: ReminderLogItem): { label: string; tone: NoticeTone } {
  if (item.status === 'pending') return { label: 'Enviando', tone: 'neutral' }
  if (item.status === 'skipped') return { label: 'No enviado', tone: 'warning' }
  if (item.status === 'failed') return { label: 'Falló', tone: 'danger' }
  switch (item.delivery_status) {
    case 'read': return { label: 'Leído', tone: 'success' }
    case 'delivered': return { label: 'Entregado', tone: 'success' }
    case 'failed': return { label: 'No llegó', tone: 'danger' }
    default: return { label: 'Enviado', tone: 'neutral' }
  }
}
