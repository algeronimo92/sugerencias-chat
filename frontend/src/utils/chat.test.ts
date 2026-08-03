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
  it('prioriza el nombre y luego el teléfono', () => {
    expect(displayName(chat({ name: 'Briss', phone: '+51943663225' }))).toBe('Briss')
    expect(displayName(chat({ phone: '+51943663225' }))).toBe('+51943663225')
  })

  it('usa el UUID interno cuando tampoco existe teléfono', () => {
    const lead = chat({})

    expect(displayName(lead)).toBe(`Lead #${lead.chat_id}`)
    expect(avatarInitial(lead)).toBe('#')
  })
})
