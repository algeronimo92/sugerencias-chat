import { describe, expect, it } from 'vitest'

import type { Message } from '../types'
import { mediaDownloadUrl, messageMediaFilename } from './media'

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    sender: 'cliente',
    content: null,
    sent_at: '2026-08-13T09:42:00Z',
    media_url: '/media/abc123.jpg',
    wa_message_id: 'wa-1',
    status: 'READ',
    message_type: 'image',
    ...overrides,
  } as Message
}

describe('descarga multimedia', () => {
  it('conserva y sanea el nombre original', () => {
    expect(messageMediaFilename(message({ payload: { filename: '../antes/después.jpg' } })))
      .toBe('después.jpg')
  })

  it('genera un nombre fechado cuando WhatsApp no envía filename', () => {
    expect(messageMediaFilename(message())).toBe('image-2026-08-13_09-42.jpg')
  })

  it('agrega la instrucción de descarga a las URLs servidas por el backend', () => {
    const url = mediaDownloadUrl('/media/abc123.jpg', 'resultado final.jpg')

    expect(url).toContain('/media/abc123.jpg?download=resultado+final.jpg')
  })
})
