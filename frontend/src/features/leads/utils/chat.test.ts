import { describe, expect, it } from 'vitest'
import type { Chat } from '../types'
import { avatarInitial, displayName } from './chat'

const chat = (values: Partial<Chat>): Chat => ({
  chat_id: '7b08f4d9-855f-4718-b95f-9c021da52f77',
  name: null,
  phone: null,
  ...values,
} as Chat)

describe('identidad visible del contacto', () => {
  it('prioriza el username y luego el pushname', () => {
    expect(displayName(chat({ username: '@gporta.21', name: 'Gerson Portal' }))).toBe('@gporta.21')
    expect(displayName(chat({ username: 'gporta.21', name: 'Gerson Portal' }))).toBe('@gporta.21')
    expect(displayName(chat({ name: 'Briss', phone: '51943663225' }))).toBe('Briss')
  })

  it('usa el teléfono cuando no existe username ni nombre útil', () => {
    const lead = chat({ phone: '51943663225' })

    expect(displayName(lead)).toBe('51943663225')
    expect(avatarInitial(lead)).toBe('5')
  })

  it('usa el UUID interno solo cuando tampoco existe teléfono', () => {
    const lead = chat({})

    expect(displayName(lead)).toBe(`Lead #${lead.chat_id}`)
    expect(avatarInitial(lead)).toBe('#')
  })

  it('usa la primera letra útil del username en el avatar', () => {
    expect(avatarInitial(chat({ username: '@gporta.21' }))).toBe('G')
  })
  it.each(['😀 Ana', '👩🏽‍⚕️ Ana', '🇵🇪 Ana', '❤️ Ana', '1️⃣ Ana', '  ✨ Ana'])('ignora emojis en %s', name => {
    expect(avatarInitial(chat({ name }))).toBe('A')
    expect(displayName(chat({ name }))).toBe(name.trim())
  })

  it('conserva letras Unicode y números', () => {
    expect(avatarInitial(chat({ name: '🌸 élena' }))).toBe('É')
    expect(avatarInitial(chat({ name: '李' }))).toBe('李')
    expect(avatarInitial(chat({ name: '123 Ana' }))).toBe('1')
  })

  it.each([null, '', '   ', '👩🏽‍⚕️✨', '1️⃣', '❤️', '🇵🇪', '...'])('usa el teléfono si %s no tiene inicial', name => {
    expect(displayName(chat({ name, phone: '+51943663225' }))).toBe('+51943663225')
    expect(avatarInitial(chat({ name, phone: '+51943663225' }))).toBe('5')
    expect(displayName(chat({ name }))).toBe(`Lead #${chat({}).chat_id}`)
    expect(avatarInitial(chat({ name }))).toBe('#')
  })

  it('ignora usernames vacíos y conserva la prioridad de los válidos', () => {
    expect(displayName(chat({ username: '@', name: '✨', phone: '51943663225' }))).toBe('51943663225')
    expect(displayName(chat({ username: '@ana', name: '✨', phone: '51943663225' }))).toBe('@ana')
    expect(avatarInitial(chat({ username: '@ana', name: '✨', phone: '51943663225' }))).toBe('A')
  })

})
