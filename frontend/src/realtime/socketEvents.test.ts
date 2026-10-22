import { describe, expect, it } from 'vitest'
import { parseChatSocketEvent } from './socketEvents'

describe('parseChatSocketEvent', () => {
  it('descarta tipos que no están en el contrato', () => {
    expect(parseChatSocketEvent(JSON.stringify({ type: 'internal_note_mention' }))).toBeNull()
  })

  it('conserva un motivo conocido y descarta uno desconocido', () => {
    const known = parseChatSocketEvent(JSON.stringify({ type: 'chats_updated', chat_id: 'c1', reason: 'stage_changed' }))
    const unknown = parseChatSocketEvent(JSON.stringify({ type: 'chats_updated', chat_id: 'c1', reason: 'stage_chaged' }))

    expect(known).toMatchObject({ type: 'chats_updated', reason: 'stage_changed' })
    expect(unknown).toMatchObject({ type: 'chats_updated', reason: undefined })
  })

  it('filtra estados de mensaje inválidos', () => {
    const event = parseChatSocketEvent(JSON.stringify({
      type: 'chats_updated',
      message_statuses: [
        { id: 1, meta_status: 'read' },
        { id: 2, outbox_status: 'NOPE' },
        { id: 3, outbox_status: 'failed', meta_status: 'future_status' },
      ],
    }))

    // El estado de la cola se valida; el de Meta pasa literal aunque sea nuevo.
    expect(event).toMatchObject({
      message_statuses: [
        { id: 1, meta_status: 'read' },
        { id: 3, outbox_status: 'failed', meta_status: 'future_status' },
      ],
    })
  })
})
