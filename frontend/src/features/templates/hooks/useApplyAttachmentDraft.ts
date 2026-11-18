import { fileToBase64 } from '../domain/attachmentFiles'
import { planAttachmentSync, type DraftAttachment } from '../domain/attachmentDraft'
import type { TemplateAttachment } from '../types'
import {
  useAddLibraryTemplateAttachment,
  useDeleteTemplateAttachment,
  useReorderTemplateAttachments,
  useUploadTemplateAttachment,
} from './useTemplates'

/**
 * Aplica el borrador de adjuntos de una plantilla: borra los quitados, sube
 * o vincula los nuevos y, si hace falta, fija el orden. Primero se borra,
 * así el tope de 10 adjuntos cuenta solo lo que queda.
 */
export function useApplyAttachmentDraft() {
  const upload = useUploadTemplateAttachment()
  const addFromLibrary = useAddLibraryTemplateAttachment()
  const remove = useDeleteTemplateAttachment()
  const reorder = useReorderTemplateAttachments()

  async function apply(templateId: number, saved: TemplateAttachment[], draft: DraftAttachment[]) {
    const plan = planAttachmentSync(saved, draft)
    for (const id of plan.removeIds) await remove.mutateAsync(id)

    const idByKey = new Map(draft.flatMap(item => item.source === 'saved' ? [[item.key, item.attachment.id] as const] : []))
    for (const item of plan.additions) {
      const created = item.source === 'upload'
        ? await upload.mutateAsync({
          templateId,
          contentType: item.file.type,
          dataBase64: await fileToBase64(item.file),
          filename: item.file.name,
        })
        : await addFromLibrary.mutateAsync({ templateId, assetId: item.asset.id })
      idByKey.set(item.key, created.id)
    }

    // Los nuevos quedan al final al subirlos: solo hace falta ordenar si el
    // orden pedido no es ese.
    const ordered = plan.orderKeys.map(key => idByKey.get(key)).filter((id): id is number => id != null)
    const asStored = [
      ...saved.filter(attachment => !plan.removeIds.includes(attachment.id))
        .sort((left, right) => left.position - right.position || left.id - right.id)
        .map(attachment => attachment.id),
      ...plan.additions.map(item => idByKey.get(item.key)).filter((id): id is number => id != null),
    ]
    if (ordered.some((id, index) => id !== asStored[index])) {
      await reorder.mutateAsync({ templateId, attachmentIds: ordered })
    }
  }

  const pending = upload.isPending || addFromLibrary.isPending || remove.isPending || reorder.isPending
  return { apply, pending }
}
