import { describe, expect, it } from 'vitest'
import { canSaveConnection, connectionRules } from './erpConnection'

const off = { enabled: false, url: '', tokenConfigured: false }
const on = { enabled: true, url: 'https://erp.example', tokenConfigured: true }

describe('reglas de la conexión de citas con el ERP', () => {
  it('encender exige probar antes de guardar', () => {
    const rules = connectionRules(off, { enabled: true, url: ' https://erp.example ', token: ' secreto ' })

    expect(rules).toEqual({ dirty: true, needsTest: true, canTest: true, key: 'https://erp.example|secreto' })
    expect(canSaveConnection(rules, false)).toBe(false)
    expect(canSaveConnection(rules, true)).toBe(true)
  })

  it('apagar no exige nada', () => {
    const rules = connectionRules(on, { enabled: false, url: on.url, token: '' })

    expect(rules).toMatchObject({ dirty: true, needsTest: false })
    expect(canSaveConnection(rules, false)).toBe(true)
  })

  it('cambiar la dirección o el token estando encendido exige volver a probar', () => {
    expect(connectionRules(on, { enabled: true, url: 'https://otro.example', token: '' }).needsTest).toBe(true)
    expect(connectionRules(on, { enabled: true, url: on.url, token: 'nuevo' }).needsTest).toBe(true)
  })

  it('sin cambios no hay nada que guardar', () => {
    const rules = connectionRules(on, { enabled: true, url: on.url, token: '' })

    expect(rules).toMatchObject({ dirty: false, needsTest: false })
    expect(canSaveConnection(rules, true)).toBe(false)
  })

  it('solo se puede probar con dirección válida y algún token', () => {
    expect(connectionRules(off, { enabled: true, url: 'erp.example', token: 'secreto' }).canTest).toBe(false)
    expect(connectionRules(off, { enabled: true, url: 'https://erp.example', token: '' }).canTest).toBe(false)
    // Con token guardado alcanza la dirección.
    expect(connectionRules(on, { enabled: true, url: 'https://erp.example', token: '' }).canTest).toBe(true)
  })
})
