import { describe, expect, it } from 'vitest'
import { flowStatus } from './flowStatus'

describe('estado del flujo en la cabecera', () => {
  it('distingue borrador, cambios sin publicar, pausado y activo', () => {
    expect(flowStatus(null, true, false).label).toBe('Borrador · sin publicar')
    expect(flowStatus(14, true, true).label).toBe('Cambios sin publicar · en uso la v14')
    expect(flowStatus(14, false, false).label).toBe('Pausado · v14')
    expect(flowStatus(14, false, true).label).toBe('Activo · v14')
  })
})
