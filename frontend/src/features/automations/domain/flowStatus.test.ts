import { describe, expect, it } from 'vitest'
import { flowStatus } from './flowStatus'

describe('estado del flujo en la cabecera', () => {
  it('distingue borrador, cambios sin publicar, pausado y publicado', () => {
    expect(flowStatus(null, true, false).label).toBe('Borrador · sin publicar')
    expect(flowStatus(14, true, true).label).toBe('Cambios sin publicar · v14 en uso')
    expect(flowStatus(14, false, false).label).toBe('Pausada · v14')
    expect(flowStatus(14, false, true).label).toBe('Publicada · v14')
  })

  it('no esconde la pausa cuando además hay cambios sin publicar', () => {
    expect(flowStatus(14, true, false)).toMatchObject({ label: 'Pausada · cambios sin publicar', tone: 'paused' })
  })

  it('explica qué significa cada estado para los leads', () => {
    expect(flowStatus(null, false, false).hint).toBe('Todavía no se publicó: ningún lead entra a esta automatización.')
    expect(flowStatus(14, true, true).hint).toBe('Los leads siguen recibiendo la v14. Publica para aplicar tus cambios.')
    expect(flowStatus(14, false, false).hint).toBe('No entran leads nuevos. Puedes reanudarla al publicar.')
    expect(flowStatus(14, true, false).hint).toBe('No entran leads nuevos. Puedes reanudarla al publicar.')
    expect(flowStatus(14, false, true).hint).toBe('Esta es la versión que reciben los leads que entran.')
  })
})
