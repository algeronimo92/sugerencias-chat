import { describe, expect, it } from 'vitest'

import { keepImageInMemory } from './media'

describe('keepImageInMemory', () => {
  it('copia una foto con su nombre y tipo, sin depender del archivo original', async () => {
    const original = new File(['pixeles'], 'foto.jpg', { type: 'image/jpeg', lastModified: 1 })

    const copy = await keepImageInMemory(original)

    expect(copy).not.toBe(original)
    expect(copy).toMatchObject({ name: 'foto.jpg', type: 'image/jpeg', lastModified: 1 })
    expect(await copy.text()).toBe('pixeles')
  })

  it('deja los videos y documentos como vienen', async () => {
    const video = new File(['v'], 'clip.mp4', { type: 'video/mp4' })
    expect(await keepImageInMemory(video)).toBe(video)
  })

  it('falla si la foto ya no se puede leer', async () => {
    const unreadable = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    unreadable.arrayBuffer = () => Promise.reject(new DOMException('gone', 'NotReadableError'))

    await expect(keepImageInMemory(unreadable)).rejects.toThrow()
  })
})
