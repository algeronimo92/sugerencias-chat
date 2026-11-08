import { describe, expect, it } from 'vitest'
import { editFieldHref, readEditField, withoutEditField } from './editFieldLink'

describe('editFieldLink', () => {
  it('arma el enlace y lo lee de vuelta, con motivo opcional', () => {
    const href = editFieldHref('/chat/abc', 'servicio_interes', 'Para eliminar «Botox & Co»')
    const params = new URLSearchParams(href.split('?')[1])
    expect(href.startsWith('/chat/abc?')).toBe(true)
    expect(readEditField(params)).toEqual({ field: 'servicio_interes', reason: 'Para eliminar «Botox & Co»' })
    expect(readEditField(new URLSearchParams(editFieldHref('/x', 'nombre').split('?')[1]))).toEqual({ field: 'nombre', reason: null })
    expect(readEditField(new URLSearchParams('otro=1'))).toBeNull()
  })

  it('quita solo sus parámetros', () => {
    const params = new URLSearchParams('editar=servicio_interes&motivo=x&filtro=abiertos')
    expect(withoutEditField(params).toString()).toBe('filtro=abiertos')
  })
})
