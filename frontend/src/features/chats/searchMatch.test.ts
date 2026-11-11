import { describe, expect, it } from 'vitest'
import type { Chat, MessageSearchHit } from '../leads/types'
import { contactMatchReason, formatHitDate, hitName } from './searchMatch'

const chat = (overrides: Partial<Chat>): Chat => ({
  chat_id: 'dc1c430c-7a8f', name: 'Rocío Mendoza', username: null, phone: '+51983049189', secondary_phone: null,
  servicio_interes: null, vendedor: null, origen: null, ...overrides,
} as Chat)

const hit = (overrides: Partial<MessageSearchHit>): MessageSearchHit => ({
  message_id: 1, chat_id: 'dc1c430c-7a8f', sender: 'vendedor', ...overrides,
})

// Antes estas filas mostraban solo el último mensaje del chat y parecía que
// el buscador no había encontrado nada.
describe('por qué aparece un contacto', () => {
  it('dice el servicio cuando el lead matcheó por su servicio de interés', () => {
    expect(contactMatchReason(chat({ servicio_interes: 'Limpieza Facial' }), 'LIMPIEZA FACIAL'))
      .toEqual({ label: 'Servicio', value: 'Limpieza Facial' })
  })

  it('no agrega nada si el nombre a la vista ya trae todo lo buscado', () => {
    expect(contactMatchReason(chat({ name: 'Esthefany Linares Limpieza Facial', servicio_interes: 'Limpieza Facial' }), 'limpieza facial')).toBeNull()
  })

  it('explica la palabra que el nombre no trae: la vendedora asignada', () => {
    expect(contactMatchReason(chat({ vendedor: 'Grecia Geronimo', servicio_interes: 'Botox' }), 'rocio grecia'))
      .toEqual({ label: 'Asignado a', value: 'Grecia Geronimo' })
  })

  it('muestra el nombre cuando la fila enseña el usuario de WhatsApp', () => {
    expect(contactMatchReason(chat({ username: 'paoocx.r', name: 'Paola Cruz' }), 'cruz'))
      .toEqual({ label: 'Nombre', value: 'Paola Cruz' })
  })

  it('reconoce un teléfono escrito con otro formato', () => {
    expect(contactMatchReason(chat({}), '983 049 189')).toEqual({ label: 'Teléfono', value: '+51983049189' })
  })
})

describe('un mensaje encontrado', () => {
  it('nombra al lead por usuario, nombre o teléfono, nunca por su id interno', () => {
    expect(hitName(hit({ username: 'paoocx.r', name: 'Paola' }))).toBe('@paoocx.r')
    expect(hitName(hit({ name: 'Paola' }))).toBe('Paola')
    expect(hitName(hit({ phone: '+51 983 049 189' }))).toBe('+51 983 049 189')
    expect(hitName(hit({}))).toBe('Sin nombre')
  })

  it('muestra la fecha del mensaje, corta como en WhatsApp', () => {
    const now = new Date(2026, 10, 11, 10, 40)
    expect(formatHitDate(new Date(2026, 10, 11, 10, 35).toISOString(), now)).toMatch(/10:35/)
    expect(formatHitDate(new Date(2026, 10, 10, 23, 59).toISOString(), now)).toBe('Ayer')
    expect(formatHitDate(new Date(2026, 10, 7, 9, 0).toISOString(), now)).toBe('sábado')
    expect(formatHitDate(new Date(2026, 9, 2, 9, 0).toISOString(), now)).toBe('02/10/26')
    expect(formatHitDate(null, now)).toBe('')
  })
})
