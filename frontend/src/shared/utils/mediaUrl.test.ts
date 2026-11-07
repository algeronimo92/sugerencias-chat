import { describe, expect, it } from 'vitest'

import { resolveMediaUrl, thumbnailUrl } from './mediaUrl'

describe('thumbnailUrl', () => {
  it('apunta a la miniatura del backend para los archivos de la biblioteca', () => {
    expect(thumbnailUrl('/media/promo.png')).toMatch(/\/media\/promo\.png\/thumbnail$/)
    expect(thumbnailUrl('/media/promo.png')).toBe(`${resolveMediaUrl('/media/promo.png')}/thumbnail`)
  })

  it('conserva nombres con caracteres codificados y descarta parámetros', () => {
    expect(thumbnailUrl('/media/foto%20uno.jpg?download=x')).toMatch(/\/media\/foto%20uno\.jpg\/thumbnail$/)
  })

  it('no inventa miniaturas para lo que el backend no sirve', () => {
    expect(thumbnailUrl(null)).toBeNull()
    expect(thumbnailUrl('')).toBeNull()
    expect(thumbnailUrl('data:image/png;base64,AAAA')).toBeNull()
    expect(thumbnailUrl('blob:http://localhost/123')).toBeNull()
    expect(thumbnailUrl('https://cdn.example.com/foto.png')).toBeNull()
    expect(thumbnailUrl('/media/')).toBeNull()
    expect(thumbnailUrl('/api/media-library/1')).toBeNull()
  })
})
