import type { CallPermission } from '../types'

export type CallButtonAction = 'call' | 'request' | 'retry' | 'none'

export interface CallButtonState {
  hint: string
  action: CallButtonAction
}

/** Qué hace el botón según lo que Meta informa: la persona sabe qué va a
 *  pasar antes de tocarlo, en vez de enterarse por un error. */
export function callButtonState(permission: CallPermission | undefined, failed: boolean): CallButtonState {
  if (failed) return { hint: 'No se pudo consultar el permiso. Toca para reintentar.', action: 'retry' }
  if (!permission) return { hint: 'Consultando el permiso…', action: 'none' }
  if (permission.can_call) {
    const until = permission.status === 'temporary' && permission.expires_at
      ? `Llamar. Con permiso hasta el ${new Date(permission.expires_at).toLocaleDateString('es', { day: 'numeric', month: 'short' })}`
      : 'Llamar. Con permiso para llamar'
    const left = permission.calls_left_before_losing_permission
    // Meta quita el permiso a las cuatro llamadas seguidas sin contestar.
    const warning = left != null
      ? ` · Si no contesta ${left === 1 ? 'una vez más' : `${left} veces más`}, perderás el permiso para llamarle`
      : ''
    return { hint: until + warning, action: 'call' }
  }
  if (permission.status !== 'none') return { hint: 'Se alcanzó el límite de llamadas por hoy', action: 'none' }
  return permission.can_request
    ? { hint: 'Pedir permiso para llamar: el cliente todavía no lo dio', action: 'request' }
    : { hint: 'El cliente no dio permiso y ya se le pidió: hay que esperar para volver a pedirlo', action: 'none' }
}
