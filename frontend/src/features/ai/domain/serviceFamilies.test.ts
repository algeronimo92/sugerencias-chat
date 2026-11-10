import { describe, expect, it } from 'vitest'
import { familyMembers, groupByFamily, serviceFamily } from './serviceFamilies'

const SERVICES = [
  { id: 1, name: 'Botox - 1 Zona' },
  { id: 2, name: 'Botox - 2 Zonas' },
  { id: 3, name: 'Hollywood Peel - Rostro' },
  { id: 4, name: 'Amber Glow' },
  { id: 5, name: 'Botox - 3 Zonas', is_active: false },
]

describe('serviceFamily', () => {
  it('es lo que va antes de « - »; sin guion, el nombre entero', () => {
    expect(serviceFamily('Botox - 1 Zona')).toBe('Botox')
    expect(serviceFamily('Hollywood Peel - Rostro + Cuello')).toBe('Hollywood Peel')
    expect(serviceFamily('Amber Glow')).toBe('Amber Glow')
  })
})

describe('groupByFamily', () => {
  it('agrupa por tratamiento en el orden del catálogo', () => {
    expect(groupByFamily(SERVICES).map(group => [group.name, group.services.map(service => service.id)])).toEqual([
      ['Botox', [1, 2, 5]],
      ['Hollywood Peel', [3]],
      ['Amber Glow', [4]],
    ])
  })
})

describe('familyMembers', () => {
  it('desde una zona devuelve todas las zonas activas del tratamiento', () => {
    expect(familyMembers(SERVICES, 1)).toEqual([1, 2])
    expect(familyMembers(SERVICES, 4)).toEqual([4])
  })

  it('un servicio desconocido se queda solo', () => {
    expect(familyMembers(SERVICES, 99)).toEqual([99])
  })
})
