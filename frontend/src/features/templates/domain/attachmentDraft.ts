import type { MediaAsset } from '../../media/types'
import type { TemplateAttachment } from '../types'

/**
 * Los adjuntos de una plantilla mientras se editan (2026-11-18).
 *
 * Los cambios quedan en borrador y se aplican al guardar, como el nombre y
 * el texto: «Cancelar» no deja la plantilla a medio cambiar. Al guardar se
 * borran los quitados, se suben o vinculan los nuevos y se fija el orden.
 */
export const MAX_TEMPLATE_ATTACHMENTS = 10
/** El mismo tope que `MEDIA_CAPTION_MAX_LENGTH` del backend (contrato de Meta). */
export const CAPTION_MAX_LENGTH = 1024

export type DraftAttachment =
  | { key: string; source: 'saved'; attachment: TemplateAttachment }
  | { key: string; source: 'upload'; file: File }
  | { key: string; source: 'library'; asset: MediaAsset }

export function draftFromSaved(attachments: TemplateAttachment[]): DraftAttachment[] {
  return [...attachments]
    .sort((left, right) => left.position - right.position || left.id - right.id)
    .map(attachment => ({ key: `saved-${attachment.id}`, source: 'saved', attachment }))
}

export function draftContentType(item: DraftAttachment): string {
  if (item.source === 'saved') return item.attachment.content_type
  if (item.source === 'library') return item.asset.content_type
  return item.file.type
}

export function draftFilename(item: DraftAttachment): string {
  if (item.source === 'saved') return item.attachment.filename
  if (item.source === 'library') return item.asset.filename
  return item.file.name
}

/** Mueve el adjunto `index` un lugar (`-1` arriba, `1` abajo). */
export function moveDraft(items: DraftAttachment[], index: number, delta: -1 | 1): DraftAttachment[] {
  const target = index + delta
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/**
 * Qué adjunto lleva el texto como pie de foto. Espejo de
 * `build_internal_template_items` en el backend: el primero que no es audio
 * (WhatsApp no admite pie en audios), si el texto cabe en un pie. Si no hay
 * ninguno, el texto va como mensaje aparte.
 */
export function captionIndex(items: DraftAttachment[], text: string): number | null {
  const length = text.trim().length
  if (!length || length > CAPTION_MAX_LENGTH) return null
  const index = items.findIndex(item => !draftContentType(item).startsWith('audio/'))
  return index === -1 ? null : index
}

export interface AttachmentSyncPlan {
  removeIds: number[]
  additions: Exclude<DraftAttachment, { source: 'saved' }>[]
  /** El orden final, por clave del borrador; las nuevas reciben id al subir. */
  orderKeys: string[]
}

export function planAttachmentSync(saved: TemplateAttachment[], draft: DraftAttachment[]): AttachmentSyncPlan {
  const kept = new Set(draft.flatMap(item => item.source === 'saved' ? [item.attachment.id] : []))
  return {
    removeIds: saved.filter(attachment => !kept.has(attachment.id)).map(attachment => attachment.id),
    additions: draft.filter((item): item is Exclude<DraftAttachment, { source: 'saved' }> => item.source !== 'saved'),
    orderKeys: draft.map(item => item.key),
  }
}

export function attachmentsChanged(saved: TemplateAttachment[], draft: DraftAttachment[]): boolean {
  const original = draftFromSaved(saved).map(item => item.key)
  return original.length !== draft.length || original.some((key, index) => key !== draft[index].key)
}
