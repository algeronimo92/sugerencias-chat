/** Cómo se muestra el estado de un flujo: el texto y su color. */
export type FlowStatusTone = 'draft' | 'pending' | 'paused' | 'live'

export function flowStatus(publishedVersion: number | null, hasUnpublishedChanges: boolean, isActive: boolean): { label: string; tone: FlowStatusTone } {
  if (!publishedVersion) return { label: 'Borrador · sin publicar', tone: 'draft' }
  if (hasUnpublishedChanges) return { label: `Cambios sin publicar · en uso la v${publishedVersion}`, tone: 'pending' }
  if (!isActive) return { label: `Pausado · v${publishedVersion}`, tone: 'paused' }
  return { label: `Activo · v${publishedVersion}`, tone: 'live' }
}
