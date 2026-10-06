/**
 * Caracterización del tiempo real (fase 0 del refactor del frontend).
 *
 * Fija qué datos se refrescan con cada evento del WebSocket, qué avisos se
 * muestran y a dónde lleva tocarlos, y qué se resincroniza al reconectar.
 * La fase 2 reparte estos handlers entre las features; este test tiene que
 * seguir pasando igual.
 *
 * Se siembran en la caché todas las claves que el tiempo real puede tocar y
 * se compara el conjunto exacto de las que quedaron invalidadas: refrescar de
 * más también es una regresión (tráfico y parpadeos).
 */

import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { deferred } from '../test/fakeApi'
import { FakeWebSocket, installFakeSocket } from '../test/fakeSocket'
import { createTestQueryClient, queryWrapper } from '../test/queryWrapper'
import type { InternalMentionFn, NotifyFn } from './socketHandlers'
import { useChatUpdates } from './useRealtime'

const CHAT = '3f6a9d2e-7c41-4b8a-9e15-2d0c8f7b6a53'
const OTHER = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f'

installFakeSocket()

const SEEDED: QueryKey[] = [
  ['chats'], ['chats', 'list', '', {}], ['unread-count'], ['kanban'], ['dashboard'], ['notifications'],
  ['messages', CHAT], ['messages', OTHER], ['chat', CHAT], ['chat', OTHER],
  ['lead-activity', CHAT], ['lead-activity', OTHER],
  ['customer-service-window', CHAT], ['customer-service-window', OTHER],
  ['pinned-messages', CHAT], ['suggestions', CHAT],
  ['issue-reports'], ['templates'], ['tasks'], ['media-library'],
  ['automations'], ['automation-executions'], ['automation-manual-flows'], ['lead-stages'],
  ['scheduled-messages', CHAT], ['scheduled-messages', OTHER],
  ['internal-notes', CHAT], ['internal-notes', OTHER],
]

let queryClient: QueryClient
let notify: Mock<NotifyFn>
let onMention: Mock<InternalMentionFn>

beforeEach(() => {
  queryClient = createTestQueryClient()
  for (const key of SEEDED) {
    queryClient.setQueryData(key, key[0] === 'messages' ? { pages: [{ items: [], has_more: false }], pageParams: [null] } : [])
  }
  notify = vi.fn<NotifyFn>()
  onMention = vi.fn<InternalMentionFn>()
})

function connect() {
  return renderHook(() => {
    useChatUpdates(null, notify, onMention)
    return useLocation()
  }, { wrapper: queryWrapper(queryClient) })
}

function invalidated(): string[] {
  return SEEDED
    .filter(key => queryClient.getQueryState(key)?.isInvalidated)
    .map(key => JSON.stringify(key))
    .sort()
}

function keys(...expected: QueryKey[]): string[] {
  return expected.map(key => JSON.stringify(key)).sort()
}

function emit(payload: object) {
  act(() => FakeWebSocket.last.emit(payload))
}

describe('señales simples', () => {
  it.each([
    ['tasks_updated', [['tasks'], ['dashboard']]],
    ['templates_updated', [['templates']]],
    ['media_library_updated', [['media-library']]],
    ['notifications_updated', [['notifications']]],
    ['automations_updated', [['automations'], ['automation-executions'], ['automation-manual-flows']]],
    ['issue_reports_updated', [['issue-reports']]],
    ['lead_stages_updated', [['lead-stages'], ['kanban'], ['dashboard']]],
  ] as const)('%s refresca solo lo suyo', (type, expected) => {
    connect()
    emit({ type })
    expect(invalidated()).toEqual(keys(...expected))
    expect(notify).not.toHaveBeenCalled()
  })

  it('mensajes programados de un chat refrescan solo ese chat', () => {
    connect()
    emit({ type: 'scheduled_messages_updated', chat_id: CHAT })
    expect(invalidated()).toEqual(keys(['scheduled-messages', CHAT]))
  })

  it('mensajes programados sin chat refrescan todos', () => {
    connect()
    emit({ type: 'scheduled_messages_updated' })
    expect(invalidated()).toEqual(keys(['scheduled-messages', CHAT], ['scheduled-messages', OTHER]))
  })

  it('notas internas refrescan las notas y la actividad del lead', () => {
    connect()
    emit({ type: 'internal_notes_updated', lead_id: CHAT })
    expect(invalidated()).toEqual(keys(['internal-notes', CHAT], ['lead-activity', CHAT]))
  })

  it('un evento desconocido o mal formado no toca nada', () => {
    connect()
    emit({ type: 'algo_nuevo' })
    act(() => FakeWebSocket.last.onmessage?.({ data: 'no es json' }))
    emit({ type: 'internal_notes_updated' })
    expect(invalidated()).toEqual([])
  })
})

describe('chats_updated', () => {
  const inbound = {
    type: 'chats_updated',
    chat_id: CHAT,
    reason: 'inbound_message',
    message_statuses: [],
    latest_message: { message_id: 'wamid.1', chat_id: CHAT, sender: 'cliente', content: 'Hola, ¿precio?', name: 'Ana' },
  }

  it('un mensaje del cliente refresca su chat, la ventana, el dashboard y la sugerencia, y avisa', () => {
    const { result } = connect()
    emit(inbound)
    expect(invalidated()).toEqual(keys(
      ['chats'], ['chats', 'list', '', {}], ['unread-count'], ['chat', CHAT], ['lead-activity', CHAT],
      ['messages', CHAT], ['customer-service-window', CHAT], ['dashboard'], ['suggestions', CHAT],
    ))
    expect(notify).toHaveBeenCalledTimes(1)
    const [title, body, onClick] = notify.mock.calls[0]
    expect([title, body]).toEqual(['Ana', 'Hola, ¿precio?'])
    act(() => onClick())
    expect(result.current.pathname).toBe(`/chat/${CHAT}`)
  })

  it('el mismo mensaje no avisa dos veces', () => {
    connect()
    emit(inbound)
    emit(inbound)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('un mensaje propio no avisa ni pide sugerencia', () => {
    connect()
    emit({ ...inbound, reason: 'outbound_message', latest_message: { ...inbound.latest_message, sender: 'vendedor' } })
    expect(invalidated()).toEqual(keys(
      ['chats'], ['chats', 'list', '', {}], ['unread-count'], ['chat', CHAT], ['lead-activity', CHAT],
      ['messages', CHAT], ['dashboard'],
    ))
    expect(notify).not.toHaveBeenCalled()
  })

  it('marcar como leído no toca la actividad del lead', () => {
    connect()
    emit({ type: 'chats_updated', chat_id: CHAT, reason: 'read', message_statuses: [] })
    expect(invalidated()).toEqual(keys(['chats'], ['chats', 'list', '', {}], ['unread-count'], ['chat', CHAT], ['messages', CHAT]))
  })

  it('un cambio de etapa refresca el kanban y el dashboard', () => {
    connect()
    emit({ type: 'chats_updated', chat_id: CHAT, reason: 'stage_changed', message_statuses: [] })
    expect(invalidated()).toEqual(keys(
      ['chats'], ['chats', 'list', '', {}], ['unread-count'], ['chat', CHAT], ['lead-activity', CHAT],
      ['messages', CHAT], ['kanban'], ['dashboard'],
    ))
  })

  it('fijar un mensaje refresca los fijados del chat', () => {
    connect()
    emit({ type: 'chats_updated', chat_id: CHAT, reason: 'message_pinned', message_statuses: [] })
    expect(invalidated()).toContain(JSON.stringify(['pinned-messages', CHAT]))
  })

  it('sin chat refresca los historiales de todos y el kanban', () => {
    connect()
    emit({ type: 'chats_updated', message_statuses: [] })
    expect(invalidated()).toEqual(keys(
      ['chats'], ['chats', 'list', '', {}], ['unread-count'],
      ['messages', CHAT], ['messages', OTHER], ['lead-activity', CHAT], ['lead-activity', OTHER],
      ['customer-service-window', CHAT], ['customer-service-window', OTHER], ['kanban'],
    ))
  })

  it('con un envío en vuelo no refetchea el hilo: lo resuelve el envío', () => {
    connect()
    const inFlight = deferred<void>()
    void queryClient.getMutationCache().build(queryClient, {
      mutationKey: ['send-message', CHAT],
      mutationFn: () => inFlight.promise,
    }).execute(undefined)
    expect(queryClient.isMutating({ mutationKey: ['send-message', CHAT] })).toBe(1)
    emit({ type: 'chats_updated', chat_id: CHAT, reason: 'outbound_message', message_statuses: [] })
    expect(invalidated()).not.toContain(JSON.stringify(['messages', CHAT]))
    expect(invalidated()).toContain(JSON.stringify(['chats']))
    inFlight.resolve()
  })
})

describe('notificaciones', () => {
  function notification(overrides: object) {
    return {
      type: 'notification_created',
      notification: {
        id: 41, notification_type: 'system', title: 'Aviso', body: 'Cuerpo', lead_id: null, metadata: null, ...overrides,
      },
    }
  }

  it('avisa forzado, refresca la bandeja y lleva al chat del lead', () => {
    const { result } = connect()
    emit(notification({ lead_id: CHAT }))
    expect(invalidated()).toEqual(keys(['notifications']))
    const [title, body, onClick, options] = notify.mock.calls[0]
    expect([title, body, options]).toEqual(['Aviso', 'Cuerpo', { force: true, tag: 'notification-41' }])
    act(() => onClick())
    expect(result.current.pathname).toBe(`/chat/${CHAT}`)
  })

  it('recorta el cuerpo largo', () => {
    connect()
    emit(notification({ body: 'x'.repeat(200) }))
    expect(notify.mock.calls[0][1]).toBe(`${'x'.repeat(137)}...`)
  })

  it('un reporte de problema lleva al reporte', () => {
    const { result } = connect()
    emit(notification({ notification_type: 'issue_report', metadata: { issue_report_id: 9 } }))
    act(() => notify.mock.calls[0][2]())
    expect(`${result.current.pathname}${result.current.search}`).toBe('/reports?report=9')
  })

  it('una cita lleva a la pantalla de citas', () => {
    const { result } = connect()
    emit(notification({ notification_type: 'appointment' }))
    act(() => notify.mock.calls[0][2]())
    expect(result.current.pathname).toBe('/citas/nueva')
  })

  it('una mención en una nota interna además levanta la alerta de mención', () => {
    connect()
    emit(notification({
      notification_type: 'internal_note_mention', lead_id: CHAT, body: 'Mirá esto', metadata: { author_name: 'Luis' },
    }))
    expect(onMention).toHaveBeenCalledWith({ notificationId: 41, leadId: CHAT, authorName: 'Luis', content: 'Mirá esto' })
  })

  it('un recordatorio de tarea avisa y lleva al chat', () => {
    const { result } = connect()
    emit({ type: 'task_reminder', task: { task_id: 5, lead_id: CHAT, lead_name: 'Ana', title: 'Llamar' } })
    expect(invalidated()).toEqual(keys(['tasks']))
    const [title, body, onClick, options] = notify.mock.calls[0]
    expect([title, body, options]).toEqual(['Recordatorio: Ana', 'Llamar', { force: true, tag: 'task-reminder-5' }])
    act(() => onClick())
    expect(result.current.pathname).toBe(`/chat/${CHAT}`)
  })
})

describe('conexión', () => {
  it('al conectar resincroniza lo que depende del tiempo real', () => {
    connect()
    act(() => FakeWebSocket.last.open())
    expect(invalidated()).toEqual(keys(
      ['chats'], ['chats', 'list', '', {}], ['unread-count'], ['kanban'], ['dashboard'], ['notifications'],
      ['messages', CHAT], ['messages', OTHER], ['chat', CHAT], ['chat', OTHER], ['issue-reports'], ['templates'],
    ))
  })

  it('si se cae, reconecta a los 3 segundos', () => {
    vi.useFakeTimers()
    connect()
    act(() => FakeWebSocket.last.open())
    act(() => FakeWebSocket.last.drop())
    expect(FakeWebSocket.instances).toHaveLength(1)
    act(() => vi.advanceTimersByTime(3_000))
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('una conexión que dejó de responder se cierra para reconectar', () => {
    vi.useFakeTimers()
    connect()
    act(() => FakeWebSocket.last.open())
    act(() => vi.advanceTimersByTime(25_000))
    expect(FakeWebSocket.last.sent).toContain(JSON.stringify({ type: 'ping' }))
    act(() => vi.advanceTimersByTime(30_000))
    expect(FakeWebSocket.last.closed).toBe(true)
  })

  it('al desmontar cierra el socket y no reconecta', () => {
    vi.useFakeTimers()
    const { unmount } = connect()
    const socket = FakeWebSocket.last
    unmount()
    expect(socket.closed).toBe(true)
    act(() => vi.advanceTimersByTime(10_000))
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
