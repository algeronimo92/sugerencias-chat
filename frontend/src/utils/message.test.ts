import { describe, expect, it } from 'vitest'

import { formatDayLabel, parseContent, resolveMediaUrl, searchSnippet, splitOnMatch } from './message'

describe('parseContent', () => {
  it('trata el texto suelto como texto', () => {
    expect(parseContent('hola')).toMatchObject({ kind: 'text', text: 'hola', icon: null })
  })

  it('reconoce los sobres de multimedia que escribe el backend', () => {
    expect(parseContent('<image></image>').kind).toBe('image')
    expect(parseContent('<audio></audio>').kind).toBe('audio')
    expect(parseContent('<video></video>').kind).toBe('video')
    expect(parseContent('<location>-12.04,-77.04</location>')).toMatchObject({
      kind: 'location',
      text: '-12.04,-77.04',
    })
  })

  it('clasifica una etiqueta desconocida como adjunto en vez de perderla', () => {
    expect(parseContent('<sticker></sticker>')).toMatchObject({ kind: 'other', label: 'Adjunto' })
  })

  it('no confunde una etiqueta a medias con multimedia', () => {
    // Un cliente puede escribir esto literalmente; debe salir como texto.
    expect(parseContent('<image>').kind).toBe('text')
    expect(parseContent('mira <image></image> esto').kind).toBe('text')
  })

  it('sobrevive a null y a la cadena vacía', () => {
    expect(parseContent(null)).toMatchObject({ kind: 'text', text: '' })
    expect(parseContent('')).toMatchObject({ kind: 'text', text: '' })
  })
})

describe('resolveMediaUrl', () => {
  it('deja pasar intactas las URLs que ya son absolutas o locales', () => {
    // Los mensajes optimistas usan data:/blob: hasta que el backend responde.
    expect(resolveMediaUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
    expect(resolveMediaUrl('blob:http://x/1')).toBe('blob:http://x/1')
    expect(resolveMediaUrl('https://cdn.example/x.jpg')).toBe('https://cdn.example/x.jpg')
  })

  it('devuelve null cuando no hay media', () => {
    expect(resolveMediaUrl(null)).toBeNull()
  })

  it('prefija las rutas relativas del backend', () => {
    // En producción VITE_API_BASE_URL está vacío y la ruta queda relativa, que
    // es lo que hace que el navegador mande la cookie de sesión a /media/.
    const resolved = resolveMediaUrl('/media/foto.jpg')
    expect(resolved).toMatch(/\/media\/foto\.jpg$/)
  })
})

describe('searchSnippet', () => {
  it('devuelve el texto tal cual si el término aparece al principio', () => {
    expect(searchSnippet('hola mundo', 'hola')).toBe('hola mundo')
  })

  it('recorta por delante para que el término quede visible', () => {
    const text = 'a'.repeat(60) + ' tratamiento facial'
    const snippet = searchSnippet(text, 'tratamiento')
    expect(snippet.startsWith('… ')).toBe(true)
    expect(snippet).toContain('tratamiento')
    expect(snippet.length).toBeLessThan(text.length)
  })

  it('ignora acentos, como la búsqueda del backend', () => {
    expect(searchSnippet('consulta de depilación', 'depilacion')).toContain('depilación')
  })
})

describe('splitOnMatch', () => {
  it('parte el texto en antes, coincidencia y después', () => {
    expect(splitOnMatch('hola mundo', 'mundo')).toEqual(['hola ', 'mundo', ''])
  })

  it('devuelve null cuando el término no aparece', () => {
    expect(splitOnMatch('hola', 'xyz')).toBeNull()
    expect(splitOnMatch('hola', '   ')).toBeNull()
  })

  it('respeta los acentos del texto original al resaltar', () => {
    const parts = splitOnMatch('cita de depilación hoy', 'depilacion')
    expect(parts).not.toBeNull()
    expect(parts!.join('')).toBe('cita de depilación hoy')
  })
})

describe('formatDayLabel', () => {
  it('usa etiquetas relativas para hoy y ayer', () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    expect(formatDayLabel(today.toISOString())).toBe('Hoy')
    expect(formatDayLabel(yesterday.toISOString())).toBe('Ayer')
  })

  it('para fechas antiguas da una fecha legible, no una etiqueta relativa', () => {
    const label = formatDayLabel('2020-03-15T10:00:00.000Z')
    expect(label).not.toBe('Hoy')
    expect(label).not.toBe('Ayer')
    expect(label).toContain('2020')
  })
})
