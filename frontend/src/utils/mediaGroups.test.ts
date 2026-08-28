import { describe, expect, it } from 'vitest'

import type { Message } from '../types'
import { albumMemberIds, groupAlbumMessages } from './mediaGroups'

function message(id: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    sender: 'cliente',
    content: null,
    sent_at: '2026-08-13T09:42:00Z',
    media_url: `/media/${id}.jpg`,
    wa_message_id: `wa-${id}`,
    status: 'READ',
    message_type: 'image',
    ...overrides,
  } as Message
}

const T0 = new Date('2026-08-13T09:42:00Z')
function at(offsetSeconds: number): string {
  return new Date(T0.getTime() + offsetSeconds * 1000).toISOString()
}

describe('groupAlbumMessages', () => {
  it('agrupa 3 fotos consecutivas del mismo remitente dentro de la ventana', () => {
    const messages = [
      message(1, { sent_at: at(0) }),
      message(2, { sent_at: at(5) }),
      message(3, { sent_at: at(10) }),
    ]
    const groups = groupAlbumMessages(messages)
    expect(groups.size).toBe(1)
    expect(groups.get(1)?.map(m => m.id)).toEqual([1, 2, 3])
  })

  it('no agrupa una sola foto sin vecino', () => {
    const messages = [message(1, { sent_at: at(0) })]
    expect(groupAlbumMessages(messages).size).toBe(0)
  })

  it('corta el grupo cuando cambia el remitente', () => {
    const messages = [
      message(1, { sender: 'cliente', sent_at: at(0) }),
      message(2, { sender: 'vendedor', sent_at: at(1) }),
      message(3, { sender: 'cliente', sent_at: at(2) }),
    ]
    expect(groupAlbumMessages(messages).size).toBe(0)
  })

  it('corta el grupo cuando se excede la ventana de 60s', () => {
    const messages = [
      message(1, { sent_at: at(0) }),
      message(2, { sent_at: at(61) }),
    ]
    expect(groupAlbumMessages(messages).size).toBe(0)
  })

  it('un texto interpuesto corta el grupo', () => {
    const messages = [
      message(1, { sent_at: at(0) }),
      message(2, { sent_at: at(1), message_type: 'text', content: 'mirá esto' }),
      message(3, { sent_at: at(2) }),
    ]
    expect(groupAlbumMessages(messages).size).toBe(0)
  })

  it('un mensaje eliminado no se agrupa', () => {
    const messages = [
      message(1, { sent_at: at(0) }),
      message(2, { sent_at: at(1), deleted_at: at(30) }),
      message(3, { sent_at: at(2) }),
    ]
    expect(groupAlbumMessages(messages).size).toBe(0)
  })

  it('videos e imágenes mezclados se agrupan igual', () => {
    const messages = [
      message(1, { sent_at: at(0), message_type: 'image' }),
      message(2, { sent_at: at(2), message_type: 'video' }),
    ]
    expect(groupAlbumMessages(messages).size).toBe(1)
  })

  it('dos álbumes separados por un mensaje de texto quedan como dos grupos', () => {
    const messages = [
      message(1, { sent_at: at(0) }),
      message(2, { sent_at: at(1) }),
      message(3, { sent_at: at(2), message_type: 'text', content: 'esperá, van más' }),
      message(4, { sent_at: at(3) }),
      message(5, { sent_at: at(4) }),
    ]
    const groups = groupAlbumMessages(messages)
    expect(groups.size).toBe(2)
    expect(groups.get(1)?.map(m => m.id)).toEqual([1, 2])
    expect(groups.get(4)?.map(m => m.id)).toEqual([4, 5])
  })

  it('con album_id explícito, agrupa aunque exceda la ventana de tiempo', () => {
    const messages = [
      message(1, { sender: 'vendedor', sent_at: at(0), payload: { album_id: 'abc' } }),
      message(2, { sender: 'vendedor', sent_at: at(500), payload: { album_id: 'abc' } }),
    ]
    const groups = groupAlbumMessages(messages)
    expect(groups.size).toBe(1)
    expect(groups.get(1)?.map(m => m.id)).toEqual([1, 2])
  })

  it('album_id explícito distinto no agrupa aunque estén pegados en tiempo', () => {
    const messages = [
      message(1, { sender: 'vendedor', sent_at: at(0), payload: { album_id: 'abc' } }),
      message(2, { sender: 'vendedor', sent_at: at(1), payload: { album_id: 'xyz' } }),
    ]
    expect(groupAlbumMessages(messages).size).toBe(0)
  })

  it('un mensaje con album_id no arrastra a un vecino sin album_id', () => {
    const messages = [
      message(1, { sender: 'vendedor', sent_at: at(0), payload: { album_id: 'abc' } }),
      message(2, { sender: 'vendedor', sent_at: at(1) }),
    ]
    expect(groupAlbumMessages(messages).size).toBe(0)
  })

  it('tres fotos con el mismo album_id se agrupan en orden', () => {
    const messages = [
      message(1, { sent_at: at(0), payload: { album_id: 'abc' } }),
      message(2, { sent_at: at(2), payload: { album_id: 'abc' } }),
      message(3, { sent_at: at(4), payload: { album_id: 'abc' } }),
    ]
    const groups = groupAlbumMessages(messages)
    expect(groups.size).toBe(1)
    expect(groups.get(1)?.map(m => m.id)).toEqual([1, 2, 3])
  })
})

describe('albumMemberIds', () => {
  it('junta los ids de todos los grupos', () => {
    const groups = new Map([
      [1, [message(1), message(2)]],
      [4, [message(4), message(5), message(6)]],
    ])
    expect(albumMemberIds(groups)).toEqual(new Set([1, 2, 4, 5, 6]))
  })
})
