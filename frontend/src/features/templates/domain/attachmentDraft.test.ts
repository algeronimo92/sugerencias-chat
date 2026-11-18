import { describe, expect, it } from 'vitest'
import type { MediaAsset } from '../../media/types'
import type { TemplateAttachment } from '../types'
import { attachmentsChanged, captionIndex, draftFromSaved, moveDraft, planAttachmentSync, type DraftAttachment } from './attachmentDraft'

function saved(id: number, content_type = 'image/jpeg', position = id): TemplateAttachment {
  return { id, content_type, position, filename: `${id}.jpg`, media_url: `/media/${id}`, library_asset_id: null }
}

describe('draftFromSaved', () => {
  it('respeta el orden guardado', () => {
    expect(draftFromSaved([saved(1, 'image/jpeg', 2), saved(2, 'image/jpeg', 0)]).map(item => item.key)).toEqual(['saved-2', 'saved-1'])
  })
})

describe('captionIndex', () => {
  const draft = draftFromSaved([saved(1, 'audio/ogg'), saved(2), saved(3)])

  it('el texto va en el primer archivo que no es audio', () => {
    expect(captionIndex(draft, 'Hola')).toBe(1)
  })

  it('sin texto, o con uno más largo que un pie, ninguno lo lleva', () => {
    expect(captionIndex(draft, '  ')).toBeNull()
    expect(captionIndex(draft, 'x'.repeat(1025))).toBeNull()
  })

  it('si solo hay audios, el texto va aparte', () => {
    expect(captionIndex(draftFromSaved([saved(1, 'audio/ogg')]), 'Hola')).toBeNull()
  })
})

describe('moveDraft', () => {
  const draft = draftFromSaved([saved(1), saved(2), saved(3)])

  it('intercambia con el vecino y no se sale de la lista', () => {
    expect(moveDraft(draft, 2, -1).map(item => item.key)).toEqual(['saved-1', 'saved-3', 'saved-2'])
    expect(moveDraft(draft, 0, -1)).toBe(draft)
  })
})

describe('planAttachmentSync', () => {
  it('borra lo quitado, agrega lo nuevo y pide el orden final', () => {
    const asset = { id: 9, filename: 'logo.png', content_type: 'image/png', media_url: '/media/logo.png' } as MediaAsset
    const draft: DraftAttachment[] = [
      { key: 'library-1', source: 'library', asset },
      ...draftFromSaved([saved(3)]),
    ]

    const plan = planAttachmentSync([saved(1), saved(3)], draft)

    expect(plan.removeIds).toEqual([1])
    expect(plan.additions.map(item => item.key)).toEqual(['library-1'])
    expect(plan.orderKeys).toEqual(['library-1', 'saved-3'])
  })

  it('reconoce cuando nada cambió', () => {
    const attachments = [saved(1), saved(2)]
    expect(attachmentsChanged(attachments, draftFromSaved(attachments))).toBe(false)
    expect(attachmentsChanged(attachments, moveDraft(draftFromSaved(attachments), 0, 1))).toBe(true)
  })
})
