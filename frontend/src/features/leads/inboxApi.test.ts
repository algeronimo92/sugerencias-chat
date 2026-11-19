import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeApi } from '../../test/fakeApi'
import { bulkAssignSeller, fetchChatsPage } from './api'
import { EMPTY_CHAT_FILTERS } from './types'

const api = installFakeApi()

describe('lista de chats y bandejas contra la API', () => {
  beforeEach(() => {
    api.current.on('get', '/api/chats', { data: { items: [], has_more: false } })
  })

  it('pide la cola de espera, sin asignar y abiertas con sus parámetros', async () => {
    await fetchChatsPage('', null, { ...EMPTY_CHAT_FILTERS, unassigned: true, conversation: 'open' }, false, 'waiting')

    expect(api.current.calls('get', '/api/chats').at(-1)?.params).toEqual({ unassigned: 'true', conversation: 'open', order: 'waiting' })
  })

  it('con una búsqueda no manda el orden: manda la relevancia', async () => {
    await fetchChatsPage('botox', null, EMPTY_CHAT_FILTERS, false, 'waiting')

    expect(api.current.calls('get', '/api/chats').at(-1)?.params).toEqual({ search: 'botox' })
  })

  it('asignar vendedora a varios reusa el cambio de cada chat y separa los que fallaron', async () => {
    api.current.on('patch', '/api/chats/a', { data: {} })
    api.current.on('patch', '/api/chats/b', { status: 404, data: { detail: 'Lead no encontrado' } })

    const result = await bulkAssignSeller({ chatIds: ['a', 'b'], sellerId: 7 })

    expect(result).toEqual({ succeeded: ['a'], failed: ['b'] })
    expect(api.current.calls('patch', '/api/chats/a').at(-1)?.body).toEqual({ vendedor_id: 7 })
  })
})
