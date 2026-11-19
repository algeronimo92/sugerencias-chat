import { describe, expect, it } from 'vitest'

import { IDLE, browserCause, endMessage, formatDuration, reduceSession, type CallSession } from './callSession'

const call = { id: 7, chatId: 'lead-1', callerName: 'Josefina' }
const connecting: CallSession = { phase: 'connecting', call, outbound: false }
const active: CallSession = { phase: 'active', call, startedAt: 1_000, muted: false, unstable: false }

describe('reduceSession', () => {
  it('atender, conectar y colgar deja la duración', () => {
    let state = reduceSession(IDLE, { type: 'answer', call })
    expect(state.phase).toBe('connecting')
    state = reduceSession(state, { type: 'connected', at: 1_000 })
    expect(state.phase).toBe('active')
    state = reduceSession(state, { type: 'end', reason: 'hung_up', at: 96_400 })
    expect(state).toEqual({ phase: 'ended', call, reason: 'hung_up', durationSeconds: 95 })
    expect(reduceSession(state, { type: 'clear' })).toEqual(IDLE)
  })

  it('no atiende una segunda llamada con una en curso', () => {
    const other = { id: 8, chatId: 'lead-2', callerName: null }
    expect(reduceSession(connecting, { type: 'answer', call: other })).toBe(connecting)
    expect(reduceSession(active, { type: 'answer', call: other })).toBe(active)
  })

  it('si falla antes de conectar no inventa una duración', () => {
    expect(reduceSession(connecting, { type: 'end', reason: 'no_audio', at: 5_000 }))
      .toEqual({ phase: 'ended', call, reason: 'no_audio', durationSeconds: null })
  })

  it('silenciar e inestable solo valen con la llamada activa', () => {
    expect(reduceSession(active, { type: 'mute', muted: true })).toMatchObject({ muted: true })
    expect(reduceSession(active, { type: 'unstable', unstable: true })).toMatchObject({ unstable: true })
    expect(reduceSession(connecting, { type: 'mute', muted: true })).toBe(connecting)
    expect(reduceSession(IDLE, { type: 'end', reason: 'hung_up', at: 1 })).toBe(IDLE)
    expect(reduceSession(active, { type: 'clear' })).toBe(active)
  })
})

describe('llamada saliente', () => {
  it('toma el id que le da el backend y sigue el mismo camino', () => {
    let state = reduceSession(IDLE, { type: 'answer', call: { ...call, id: 0 }, outbound: true })
    state = reduceSession(state, { type: 'placed', callId: 42 })
    expect(state).toMatchObject({ phase: 'connecting', outbound: true, call: { id: 42 } })
    state = reduceSession(state, { type: 'end', reason: 'customer_no_answer', at: 5 })
    expect(state).toMatchObject({ phase: 'ended', reason: 'customer_no_answer' })
  })

  it('una entrante no cambia de id', () => {
    expect(reduceSession(connecting, { type: 'placed', callId: 42 })).toBe(connecting)
  })
})

describe('lo que se informa y se muestra', () => {
  it('al backend solo van los motivos de su lista cerrada', () => {
    expect(browserCause('no_audio')).toBe('no_audio')
    expect(browserCause('microphone_blocked')).toBe('microphone_blocked')
    expect(browserCause('dropped')).toBe('dropped')
    expect(browserCause('hung_up')).toBeNull()
    expect(browserCause('taken')).toBeNull()
  })

  it('el cierre normal dice la duración; un fallo, qué pasó', () => {
    expect(endMessage('hung_up', 222)).toBe('Llamada terminada · 3:42')
    expect(endMessage('remote_ended', null)).toBe('El cliente colgó')
    expect(endMessage('no_audio', 12)).toBe('No se pudo conectar el audio. Puede ser la red')
  })

  it('formatea la duración', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3600)).toBe('60:00')
  })
})
