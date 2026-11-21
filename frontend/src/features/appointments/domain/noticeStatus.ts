import type { AppointmentNotice } from '../types'

export type NoticeTone = 'success' | 'neutral' | 'danger' | 'warning'

/** Cómo se lee un aviso en el historial: lo último que se sabe de él. Lo que
 *  informó Meta después del envío (entregado, leído) manda sobre el envío. */
export function noticeState(notice: AppointmentNotice): { label: string; tone: NoticeTone } {
  if (notice.status === 'skipped') return { label: 'No enviado', tone: 'warning' }
  if (notice.status === 'failed') return { label: 'Falló', tone: 'danger' }
  switch (notice.delivery_status) {
    case 'read': return { label: 'Leído', tone: 'success' }
    case 'delivered': return { label: 'Entregado', tone: 'success' }
    case 'failed': return { label: 'No llegó', tone: 'danger' }
    default: return { label: 'Enviado', tone: 'neutral' }
  }
}

/** Un aviso que se puede reenviar: Meta no lo aceptó o informó que no llegó.
 *  El "no enviado" (sin lead o sin número) no se arregla reenviando. */
export function isFailedNotice(notice: AppointmentNotice): boolean {
  return notice.status === 'failed' || notice.delivery_status === 'failed'
}

export function noticeRecipient(notice: AppointmentNotice): string {
  return notice.audience === 'client' ? `Cliente · ${notice.recipient_name}` : notice.recipient_name
}
