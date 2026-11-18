import { describe, expect, it } from 'vitest'
import { insertAtCursor, nextMetaVariable } from './variableInsertion'

describe('insertAtCursor', () => {
  it('inserta donde está el cursor y lo deja después de la variable', () => {
    expect(insertAtCursor({ selectionStart: 5, selectionEnd: 5 }, 'Hola , ¿cómo estás?', '{{nombre}}'))
      .toEqual({ value: 'Hola {{nombre}}, ¿cómo estás?', caret: 15 })
  })

  it('reemplaza lo seleccionado', () => {
    expect(insertAtCursor({ selectionStart: 5, selectionEnd: 8 }, 'Hola Ana', '{{nombre}}').value).toBe('Hola {{nombre}}')
  })

  it('sin campo, agrega al final', () => {
    expect(insertAtCursor(null, 'Hola ', '{{nombre}}').value).toBe('Hola {{nombre}}')
  })
})

describe('nextMetaVariable', () => {
  it('sigue la numeración de la plantilla', () => {
    expect(nextMetaVariable('Hola')).toBe('{{1}}')
    expect(nextMetaVariable('Hola {{1}}, tu cita es el {{2}}')).toBe('{{3}}')
  })
})
