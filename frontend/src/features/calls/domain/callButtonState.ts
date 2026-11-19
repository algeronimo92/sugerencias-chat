import type { CallPermission } from '../types'

/** Qué dice el botón según lo que Meta informa: la persona sabe qué va a
 *  pasar antes de tocarlo, en vez de enterarse por un error. */
export function callButtonState(permission: CallPermission | undefined, failed: boolean): { label: string; hint: string; canCall: boolean } {
  if (failed) return { label: 'Llamar', hint: 'No se pudo consultar el permiso. Toca para reintentar.', canCall: false }
  if (!permission) return { label: 'Llamar', hint: 'Consultando el permiso…', canCall: false }
  if (permission.can_call) {
    const until = permission.status === 'temporary' && permission.expires_at
      ? `Con permiso hasta el ${new Date(permission.expires_at).toLocaleDateString('es', { day: 'numeric', month: 'short' })}`
      : 'Con permiso para llamar'
    return { label: 'Llamar', hint: until, canCall: true }
  }
  if (permission.status !== 'none') return { label: 'Llamar', hint: 'Se alcanzó el límite de llamadas por hoy', canCall: false }
  return {
    label: 'Llamar',
    hint: permission.can_request
      ? 'El cliente todavía no dio permiso. Envíale "Permiso de llamada" desde el botón de adjuntar.'
      : 'El cliente no dio permiso y ya se le pidió: hay que esperar para volver a pedirlo.',
    canCall: false,
  }
}
