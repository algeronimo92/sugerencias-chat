import { describe, expect, it } from 'vitest'
import { INBOUND_MESSAGE_TYPE_OPTIONS } from './inboundMessageTypes'

const labelOf = (value: string) => INBOUND_MESSAGE_TYPE_OPTIONS.find(option => option.value === value)?.label

describe('INBOUND_MESSAGE_TYPE_OPTIONS', () => {
  it('names replies and forms without showing the code', () => {
    expect(labelOf('button')).toBe('Respuesta a botón de plantilla')
    expect(labelOf('interactive/button_reply')).toBe('Respuesta a botón')
    expect(labelOf('interactive/list_reply')).toBe('Opción de una lista')
    expect(labelOf('interactive/nfm_reply')).toBe('Formulario completado')
    expect(labelOf('text')).toBe('Texto')
    for (const option of INBOUND_MESSAGE_TYPE_OPTIONS) expect(option.label).not.toContain(option.value)
  })

  it('gives every option a different label, so none is ambiguous in the list', () => {
    const labels = INBOUND_MESSAGE_TYPE_OPTIONS.map(option => option.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('offers the interactive subtypes, not the bare interactive type', () => {
    expect(labelOf('interactive')).toBeUndefined()
  })
})
