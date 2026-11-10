import { activeHolds, hasFreshForeignLease, type ActivityKind } from '../shared/activity'
import { hasOpenOverlay } from '../shared/utils/overlay'

/**
 * Por qué no conviene recargar la app ahora mismo, o `null` si no hay motivo.
 *
 * Recargar aplica el service worker nuevo en todas las pestañas: le borraría
 * el trabajo a quien esté grabando un audio, con adjuntos sin enviar, citando
 * un mensaje, con mensajes seleccionados o con cambios sin guardar en el
 * editor de flujos, y partiría un envío en vuelo. El borrador de texto no
 * bloquea: vive en localStorage y vuelve solo.
 */
export type UpdateBlocker = ActivityKind | 'sending' | 'dialog' | 'other-tab'

export function updateBlocker({ pendingSends, now = Date.now() }: { pendingSends: number; now?: number }): UpdateBlocker | null {
  const [firstHold] = activeHolds()
  if (firstHold) return firstHold
  if (pendingSends > 0) return 'sending'
  if (hasOpenOverlay()) return 'dialog'
  if (hasFreshForeignLease(now)) return 'other-tab'
  return null
}

const BLOCKER_LABELS: Record<UpdateBlocker, string> = {
  recording: 'hay una grabación de audio en curso',
  'pending-media': 'hay adjuntos sin enviar',
  'sending-media': 'se están enviando adjuntos',
  reply: 'hay una respuesta a medias',
  selection: 'hay mensajes seleccionados',
  'flow-editor': 'el editor de flujos tiene cambios sin guardar',
  sending: 'hay un mensaje enviándose',
  dialog: 'hay un diálogo abierto',
  'other-tab': 'otra pestaña del CRM está ocupada',
}

export function describeUpdateBlocker(blocker: UpdateBlocker): string {
  return BLOCKER_LABELS[blocker]
}
