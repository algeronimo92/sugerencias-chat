import { describe, expect, it } from 'vitest'

import { apiUrl, resolveApiBaseUrl, websocketUrl } from './config'

describe('resolveApiBaseUrl', () => {
  it('vacío es el mismo origen', () => {
    expect(resolveApiBaseUrl('', true)).toBe('')
  })

  it('quita la barra final de una URL absoluta', () => {
    expect(resolveApiBaseUrl('https://api.clinica.test/', true)).toBe('https://api.clinica.test')
  })

  it('sin definir, en desarrollo apunta al backend local', () => {
    expect(resolveApiBaseUrl(undefined, false)).toBe('http://localhost:8000')
  })

  it('sin definir, en producción se niega a arrancar', () => {
    expect(() => resolveApiBaseUrl(undefined, true)).toThrow(/VITE_API_BASE_URL/)
  })
})

describe('URLs del backend', () => {
  it('relativas en el mismo origen y absolutas si hay base', () => {
    expect(apiUrl('/media/a.png', '')).toBe('/media/a.png')
    expect(apiUrl('/media/a.png', 'https://api.clinica.test')).toBe('https://api.clinica.test/media/a.png')
  })

  it('el WebSocket del mismo origen sigue el esquema de la página', () => {
    expect(websocketUrl('/ws/chats', '', { protocol: 'https:', host: 'crm.clinica.test' })).toBe('wss://crm.clinica.test/ws/chats')
    expect(websocketUrl('/ws/chats', '', { protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws/chats')
  })

  it('el WebSocket de otro origen cambia http por ws', () => {
    expect(websocketUrl('/ws/chats', 'https://api.clinica.test', { protocol: 'http:', host: 'x' })).toBe('wss://api.clinica.test/ws/chats')
  })
})
