import { describe, expect, it } from 'vitest'
import { defaultPackage, erpPackages, isValidDni, packageLabel, selectedPackage } from './erpFields'

const SERVICES = [
  {
    name: 'HIFU 12D - Rostro',
    packages: [
      { id: 10, name: 'x3', sessions: 3, price: '400.00', position: 1, is_active: true, external_id: 'pkg-3' },
      { id: 11, name: 'Individual', sessions: 1, price: '150.00', position: 0, is_active: true, external_id: 'pkg-1' },
      { id: 12, name: 'Promo local', sessions: 1, price: '99.00', position: 2, is_active: true, external_id: null },
      { id: 13, name: 'x6 retirado', sessions: 6, price: '700.00', position: 3, is_active: false, external_id: 'pkg-6' },
    ],
  },
  { name: 'Evaluación', packages: [] },
]

describe('paquetes de la cita para el ERP', () => {
  it('ofrece solo los paquetes activos que existen en el ERP', () => {
    expect(erpPackages(SERVICES, '  hifu 12d - rostro ').map(item => item.id)).toEqual([10, 11])
  })

  it('no ofrece nada para un servicio que no está en el ERP o no existe', () => {
    expect(erpPackages(SERVICES, 'Evaluación')).toEqual([])
    expect(erpPackages(SERVICES, 'Otro')).toEqual([])
    expect(erpPackages(SERVICES, '')).toEqual([])
  })

  it('propone el de menos sesiones, que es la primera cita', () => {
    const packages = erpPackages(SERVICES, 'HIFU 12D - Rostro')
    expect(defaultPackage(packages)?.id).toBe(11)
    expect(defaultPackage([])).toBeNull()
  })

  it('respeta el elegido y vuelve al propuesto si ya no es de ese servicio', () => {
    const packages = erpPackages(SERVICES, 'HIFU 12D - Rostro')
    expect(selectedPackage(packages, '10')?.id).toBe(10)
    expect(selectedPackage(packages, '999')?.id).toBe(11)
    expect(selectedPackage(packages, '')?.id).toBe(11)
  })

  it('describe el paquete con sesiones y precio', () => {
    expect(packageLabel(SERVICES[0].packages[0], 'S/ ')).toBe('x3 · 3 sesiones · S/ 400.00')
    expect(packageLabel(SERVICES[0].packages[1], 'S/ ')).toBe('Individual · 1 sesión · S/ 150.00')
  })
})

describe('DNI para el ERP', () => {
  it.each(['45678912', '4567 8912', '45.678.912'])('acepta %s', value => {
    expect(isValidDni(value)).toBe(true)
  })

  it.each(['', '1234567', '123456789', 'CE001234', null, undefined])('rechaza %s', value => {
    expect(isValidDni(value)).toBe(false)
  })
})
