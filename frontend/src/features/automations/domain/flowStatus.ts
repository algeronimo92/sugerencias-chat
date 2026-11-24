/** Cómo se muestra el estado de un flujo: el texto, su explicación y su color. */
export type FlowStatusTone = 'draft' | 'pending' | 'paused' | 'live'

export interface FlowStatusView {
  label: string
  /** Qué significa para los leads; va en el tooltip de la píldora. */
  hint: string
  tone: FlowStatusTone
}

const PAUSED_HINT = 'No entran leads nuevos. Puedes reanudarla al publicar.'

export function flowStatus(publishedVersion: number | null, hasUnpublishedChanges: boolean, isActive: boolean): FlowStatusView {
  if (!publishedVersion) return { label: 'Borrador · sin publicar', hint: 'Todavía no se publicó: ningún lead entra a esta automatización.', tone: 'draft' }
  // Pausado gana: antes ganaba «Cambios sin publicar» y se perdía que no entra nadie.
  if (!isActive && hasUnpublishedChanges) return { label: 'Pausada · cambios sin publicar', hint: PAUSED_HINT, tone: 'paused' }
  if (hasUnpublishedChanges) return { label: `Cambios sin publicar · v${publishedVersion} en uso`, hint: `Los leads siguen recibiendo la v${publishedVersion}. Publica para aplicar tus cambios.`, tone: 'pending' }
  if (!isActive) return { label: `Pausada · v${publishedVersion}`, hint: PAUSED_HINT, tone: 'paused' }
  return { label: `Publicada · v${publishedVersion}`, hint: 'Esta es la versión que reciben los leads que entran.', tone: 'live' }
}
