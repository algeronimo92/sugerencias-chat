import { describe, expect, it } from 'vitest'

import { filterServices, hasExactService, normalizeServiceName } from './serviceSearch'

describe('serviceSearch', () => {
  it('normaliza tildes, mayúsculas y espacios', () => {
    expect(normalizeServiceName('  Depilación   LÁSER ')).toBe('depilacion laser')
  })

  it('filtra por subcadena y sin texto devuelve todo', () => {
    const services = [{ name: 'Limpieza facial' }, { name: 'Peeling' }]
    expect(filterServices(services, 'FACIAL')).toEqual([{ name: 'Limpieza facial' }])
    expect(filterServices(services, '  ')).toEqual(services)
  })

  it('detecta un nombre que ya existe', () => {
    expect(hasExactService([{ name: 'Consulta médica' }], 'consulta medica')).toBe(true)
    expect(hasExactService([{ name: 'Consulta médica' }], 'consulta')).toBe(false)
  })
})
