import { describe, expect, it } from 'vitest'
import { notificationImportance } from './importance'
import type { UserNotification } from './types'

function notification(overrides: Partial<UserNotification>): UserNotification {
  return {
    id: 1,
    notification_type: 'appointment',
    title: 'Aviso',
    body: '',
    lead_id: null,
    source_id: null,
    metadata: null,
    read_at: null,
    created_at: '2026-11-25T10:00:00Z',
    ...overrides,
  }
}

describe('notificationImportance', () => {
  it('un recordatorio de cita es informativo', () => {
    expect(notificationImportance(notification({ notification_type: 'appointment' }))).toBe('info')
  })

  it('una mención en nota interna pide atención', () => {
    expect(notificationImportance(notification({ notification_type: 'internal_note_mention' }))).toBe('attention')
  })

  it('el fallo de una automatización es un error, el paso "Notificar" no', () => {
    expect(notificationImportance(notification({ notification_type: 'automation', source_id: 'execution-failed:42' }))).toBe('error')
    expect(notificationImportance(notification({ notification_type: 'automation', source_id: '42' }))).toBe('info')
  })

  it('ventana de 24 h cerrada y llamadas pausadas son errores', () => {
    expect(notificationImportance(notification({ notification_type: 'service_window_closed' }))).toBe('error')
    expect(notificationImportance(notification({ notification_type: 'calls_paused' }))).toBe('error')
  })
})
