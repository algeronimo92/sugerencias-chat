/**
 * Qué decir de una cita respecto al ERP del negocio y qué se puede hacer con
 * ella. Separado del componente para que cada caso se lea (y se pruebe) solo.
 */

import type { AppointmentListItem } from '../types'

export interface ErpStatusView {
  label: string
  /** Ya está en la agenda del ERP. */
  sent: boolean
  /** Se puede (re)enviar: el envío está activo y la cita es real y vigente. */
  retryable: boolean
  /** Por qué no llegó, si se sabe. */
  error: string | null
}

const LABELS: Record<string, string> = {
  synced: 'En la agenda del ERP',
  pending: 'Pendiente de enviar al ERP',
  error: 'No llegó al ERP',
}

/**
 * null: no hay nada que mostrar. Pasa con las citas de un negocio que no
 * envía al ERP y con las de prueba, que nunca se envían; una cita anterior a
 * la integración sí aparece si ahora se puede enviar.
 */
export function erpStatusView(item: AppointmentListItem, erpActive: boolean): ErpStatusView | null {
  const status = item.erp_sync_status ?? 'not_configured'
  const sent = status === 'synced'
  const sendable = !item.test_mode && !item.dismissed_at
  const retryable = erpActive && !sent && sendable
  if (!sent && !retryable && status !== 'error') return null
  return {
    label: LABELS[status] ?? 'Sin enviar al ERP',
    sent,
    retryable,
    error: sent ? null : item.erp_sync_error ?? null,
  }
}
