/**
 * Caracterización de los envíos del hilo (fase 0 del refactor del frontend).
 *
 * Fija lo que hoy hace cada forma de enviar, para que unificarlas en un solo
 * comando no cambie nada visible:
 *
 * - la burbuja optimista aparece antes de que el servidor conteste, con la
 *   forma que tendrá el mensaje real (tipo, media, cita, cuerpo de Meta);
 * - el request que viaja (ruta y cuerpo);
 * - al confirmar, la burbuja se reemplaza por el mensaje del servidor;
 * - si falla, la burbuja desaparece;
 * - al terminar el último envío, el hilo queda marcado para refrescarse;
 * - los envíos de un chat salen en el orden en que se pulsaron.
 *
 * Intercepta la red (src/test/fakeApi.ts), no las funciones de api.ts.
 */

import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { deferred, installFakeApi, type FakeReply } from '../../../test/fakeApi'
import { createTestQueryClient, queryWrapper } from '../../../test/queryWrapper'
import { toMessage } from '../api'
import type { ContractMessage, Message, MessagePage, ReplyTarget } from '../types'
import {
  useReactToMessage,
  useSendAudio,
  useSendContacts,
  useSendInteractive,
  useSendLocation,
  useSendMedia,
  useSendMessage,
  useSendSticker,
  useSendTemplate,
} from './useMessages'

const CHAT = '9a3c2f14-1b7e-4c8d-a6f0-3e5d7b9c1a24'
const BASE = `/api/chats/${CHAT}`
const REPLY: ReplyTarget = { id: 7, sender: 'cliente', content: 'Hola' }

const api = installFakeApi()
let queryClient: QueryClient

/** Un mensaje como lo manda el backend: con todos los campos del contrato
 * (TypeScript exige que no falte ninguno). */
function serverMessage(overrides: Partial<ContractMessage> = {}): ContractMessage {
  return {
    id: 500,
    sender: 'vendedor',
    direction: 'outbound',
    content: null,
    sent_at: '2026-10-06T15:00:00Z',
    media_url: null,
    wa_message_id: null,
    outbox_status: 'queued',
    meta_status: null,
    status_payload: null,
    message_type: null,
    message_subtype: null,
    provider_payload: null,
    analysis: null,
    payload: null,
    reactions: null,
    edited_at: null,
    deleted_at: null,
    media_width: null,
    media_height: null,
    quoted_message_id: null,
    quoted_sender: null,
    quoted_content: null,
    quoted_message_type: null,
    pinned_at: null,
    error_detail: null,
    ...overrides,
  }
}

const EXISTING = toMessage(serverMessage({ id: 7, sender: 'cliente', content: 'Hola', direction: 'inbound', outbox_status: null }))

function thread(): Message[] {
  const data = queryClient.getQueryData<InfiniteData<MessagePage>>(['messages', CHAT])
  return data?.pages.flatMap(page => page.items) ?? []
}

function optimistic(): Message[] {
  return thread().filter(message => message.id < 0)
}

beforeEach(() => {
  queryClient = createTestQueryClient()
  queryClient.setQueryData<InfiniteData<MessagePage>>(['messages', CHAT], {
    pages: [{ items: [EXISTING], has_more: false }],
    pageParams: [null],
  })
})

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: queryWrapper(queryClient) }).result
}

/** Cada forma de envío: cómo se dispara, qué viaja y cómo se ve la burbuja. */
interface SendCase {
  name: string
  path: string
  send: () => (variables: never) => void
  variables: unknown
  body: unknown
  bubbles: Array<Partial<Message>>
  reply: (bodyMessage: ContractMessage) => FakeReply
}

const single = (message: ContractMessage): FakeReply => ({ data: message })

const CASES: SendCase[] = [
  {
    name: 'texto',
    path: `${BASE}/messages`,
    send: () => render(() => useSendMessage(CHAT)).current.mutate as never,
    variables: { text: 'Buenas tardes', replyTo: REPLY },
    body: { text: 'Buenas tardes', reply_to_message_id: 7 },
    bubbles: [{
      content: 'Buenas tardes', message_type: null, outbox_status: 'queued', sender: 'vendedor', direction: 'outbound',
      quoted_message_id: 7, quoted_sender: 'cliente', quoted_content: 'Hola',
    }],
    reply: single,
  },
  {
    name: 'audio',
    path: `${BASE}/audio`,
    send: () => render(() => useSendAudio(CHAT)).current.mutate as never,
    variables: { contentType: 'audio/ogg', dataBase64: 'T2dn', replyTo: null },
    body: { content_type: 'audio/ogg', data_base64: 'T2dn', reply_to_message_id: null },
    bubbles: [{ content: null, message_type: 'audio', media_url: 'data:audio/ogg;base64,T2dn' }],
    reply: single,
  },
  {
    name: 'imagen con epígrafe y álbum',
    path: `${BASE}/media`,
    send: () => render(() => useSendMedia(CHAT)).current.mutate as never,
    variables: { contentType: 'image/png', dataBase64: 'iVBO', filename: 'foto.png', caption: 'Mira', albumId: 'album-1' },
    body: {
      content_type: 'image/png', data_base64: 'iVBO', filename: 'foto.png', caption: 'Mira',
      reply_to_message_id: null, album_id: 'album-1',
    },
    bubbles: [{ content: 'Mira', message_type: 'image', media_url: 'data:image/png;base64,iVBO', payload: { album_id: 'album-1' } }],
    reply: single,
  },
  {
    name: 'documento',
    path: `${BASE}/media`,
    send: () => render(() => useSendMedia(CHAT)).current.mutate as never,
    variables: { contentType: 'application/pdf', dataBase64: 'JVBE', filename: 'precios.pdf' },
    body: {
      content_type: 'application/pdf', data_base64: 'JVBE', filename: 'precios.pdf', caption: null,
      reply_to_message_id: null, album_id: null,
    },
    bubbles: [{ content: null, message_type: 'document', payload: { filename: 'precios.pdf' } }],
    reply: single,
  },
  {
    name: 'plantilla',
    path: `${BASE}/templates/12`,
    send: () => render(() => useSendTemplate(CHAT)).current.mutate as never,
    variables: {
      templateId: 12, text: 'Hola Ana', parameters: ['Ana'],
      optimisticMessages: [{ content: 'Hola Ana' }, { content: null, message_type: 'image', media_url: '/media/a.png' }],
    },
    body: { text: 'Hola Ana', parameters: ['Ana'] },
    bubbles: [{ content: 'Hola Ana' }, { content: null, message_type: 'image', media_url: '/media/a.png' }],
    reply: message => ({ data: [message, serverMessage({ id: message.id + 1, message_type: 'image' })] }),
  },
  {
    name: 'sticker',
    path: `${BASE}/sticker`,
    send: () => render(() => useSendSticker(CHAT)).current.mutate as never,
    variables: { assetId: 3, mediaUrl: '/media/sticker.webp' },
    body: { asset_id: 3 },
    bubbles: [{ content: null, message_type: 'sticker', media_url: '/media/sticker.webp' }],
    reply: single,
  },
  {
    name: 'ubicación',
    path: `${BASE}/location`,
    send: () => render(() => useSendLocation(CHAT)).current.mutate as never,
    variables: { latitude: -12.05, longitude: -77.04, replyTo: REPLY },
    body: { latitude: -12.05, longitude: -77.04, reply_to_message_id: 7 },
    bubbles: [{
      message_type: 'location', provider_payload: { location: { latitude: -12.05, longitude: -77.04 } }, quoted_message_id: 7,
    }],
    reply: single,
  },
  {
    name: 'contactos',
    path: `${BASE}/contacts`,
    send: () => render(() => useSendContacts(CHAT)).current.mutate as never,
    variables: { contacts: [{ fullName: 'Ana Torres', phoneNumber: '+51987654321' }] },
    body: { contacts: [{ full_name: 'Ana Torres', phone_number: '+51987654321' }], reply_to_message_id: null },
    bubbles: [{
      message_type: 'contacts',
      provider_payload: { contacts: [{ name: { formatted_name: 'Ana Torres' }, phones: [{ phone: '+51987654321' }] }] },
    }],
    reply: single,
  },
  {
    name: 'interactivo',
    path: `${BASE}/interactive`,
    send: () => render(() => useSendInteractive(CHAT)).current.mutate as never,
    variables: { interactive: { type: 'product', body: { text: 'Mira este producto' } } },
    body: { interactive: { type: 'product', body: { text: 'Mira este producto' } }, reply_to_message_id: null },
    bubbles: [{
      content: 'Mira este producto', message_type: 'interactive', message_subtype: 'product',
      provider_payload: { interactive: { type: 'product', body: { text: 'Mira este producto' } } },
    }],
    reply: single,
  },
]

describe.each(CASES)('envío de $name', sendCase => {
  it('muestra la burbuja antes de que el servidor conteste y la reemplaza por la real', async () => {
    const answer = deferred<FakeReply>()
    api.current.on('post', sendCase.path, () => answer.promise)
    const mutate = sendCase.send()

    act(() => mutate(sendCase.variables as never))

    await waitFor(() => expect(optimistic()).toHaveLength(sendCase.bubbles.length))
    optimistic().forEach((bubble, index) => {
      expect(bubble).toMatchObject({ sender: 'vendedor', direction: 'outbound', outbox_status: 'queued', ...sendCase.bubbles[index] })
    })
    // La burbuja va al final del hilo, después de lo que ya estaba.
    expect(thread()[0]).toEqual(EXISTING)

    const confirmed = serverMessage({ id: 900 })
    await act(async () => answer.resolve(sendCase.reply(confirmed)))

    await waitFor(() => expect(optimistic()).toEqual([]))
    expect(thread().map(message => message.id)).toEqual(
      sendCase.name === 'plantilla' ? [7, 900, 901] : [7, 900],
    )
    expect(api.current.calls('post', sendCase.path).map(request => request.body)).toEqual([sendCase.body])
    await waitFor(() => expect(queryClient.getQueryState(['messages', CHAT])?.isInvalidated).toBe(true))
  })

  it('quita la burbuja si el servidor rechaza el envío', async () => {
    api.current.on('post', sendCase.path, { status: 500, data: { detail: 'Fallo' } })
    const mutate = sendCase.send()

    act(() => mutate(sendCase.variables as never))

    await waitFor(() => expect(api.current.calls('post', sendCase.path)).toHaveLength(1))
    await waitFor(() => expect(optimistic()).toEqual([]))
    expect(thread()).toEqual([EXISTING])
  })
})

describe('orden de los envíos', () => {
  it('un texto escrito después de un archivo sale después aunque el archivo tarde', async () => {
    const media = deferred<FakeReply>()
    api.current.on('post', `${BASE}/media`, () => media.promise)
    api.current.on('post', `${BASE}/messages`, { data: serverMessage({ id: 902, content: 'Te lo mando' }) })
    const sendMedia = render(() => useSendMedia(CHAT)).current.mutate
    const sendText = render(() => useSendMessage(CHAT)).current.mutate

    act(() => sendMedia({ contentType: 'image/jpeg', dataBase64: '/9j/' }))
    act(() => sendText({ text: 'Te lo mando' }))

    // Las dos burbujas aparecen ya, en el orden de pulsación.
    await waitFor(() => expect(optimistic().map(message => message.message_type ?? 'text')).toEqual(['image', 'text']))
    // Pero el texto no viaja hasta que el archivo termine.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(api.current.calls('post', `${BASE}/messages`)).toHaveLength(0)

    await act(async () => media.resolve({ data: serverMessage({ id: 901, message_type: 'image' }) }))

    await waitFor(() => expect(api.current.calls('post', `${BASE}/messages`)).toHaveLength(1))
    expect(api.current.requests.filter(request => request.method === 'post').map(request => request.path)).toEqual([
      `${BASE}/media`,
      `${BASE}/messages`,
    ])
  })
})

describe('reintentar y descartar un envío fallido', () => {
  const failed = toMessage(serverMessage({ id: 640, content: 'No salió', outbox_status: 'failed', meta_status: 'failed', wa_message_id: 'wamid.x' }))

  beforeEach(() => {
    queryClient.setQueryData<InfiniteData<MessagePage>>(['messages', CHAT], {
      pages: [{ items: [EXISTING, failed], has_more: false }],
      pageParams: [null],
    })
  })

  it('reintentar lo vuelve a la cola al instante y toma el mensaje del servidor', async () => {
    const answer = deferred<FakeReply>()
    api.current.on('post', `${BASE}/messages/640/retry`, () => answer.promise)
    const result = render(() => useSendMessage(CHAT))

    act(() => result.current.retryMessage(failed))

    await waitFor(() => expect(thread()[1]).toMatchObject({ id: 640, outbox_status: 'queued', meta_status: null, wa_message_id: null }))
    await act(async () => answer.resolve({ data: { ...failed, outbox_status: 'sending' } }))
    await waitFor(() => expect(thread()[1]).toMatchObject({ id: 640, outbox_status: 'sending' }))
  })

  it('si el reintento falla, vuelve a mostrarse como fallido', async () => {
    api.current.on('post', `${BASE}/messages/640/retry`, { status: 500 })
    const result = render(() => useSendMessage(CHAT))

    act(() => result.current.retryMessage(failed))

    await waitFor(() => expect(api.current.calls('post', `${BASE}/messages/640/retry`)).toHaveLength(1))
    await waitFor(() => expect(thread()[1]).toMatchObject({ id: 640, outbox_status: 'failed' }))
  })

  it('descartar lo marca como descartado sin esperar al servidor', async () => {
    const answer = deferred<FakeReply>()
    api.current.on('post', `${BASE}/messages/640/discard`, () => answer.promise)
    const result = render(() => useSendMessage(CHAT))

    act(() => result.current.discardMessage(failed))

    await waitFor(() => expect(thread()[1]).toMatchObject({ id: 640, outbox_status: 'discarded' }))
    await act(async () => answer.resolve({ data: { ...failed, outbox_status: 'discarded' } }))
  })

  it('solo se reintenta o descarta lo que falló y ya existe en el servidor', async () => {
    const result = render(() => useSendMessage(CHAT))

    act(() => {
      result.current.retryMessage({ ...failed, outbox_status: 'sent' })
      result.current.discardMessage({ ...failed, id: -3 })
    })

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(api.current.requests).toEqual([])
  })
})

describe('reacciones', () => {
  // Cualquier texto sirve: el backend falso no valida que sea un emoji.
  const THEIRS = 'reaccion-del-cliente'
  const MINE = 'reaccion-propia'

  it('pinta la reacción propia al instante y la revierte si falla', async () => {
    const withReaction = { ...EXISTING, reactions: [{ emoji: THEIRS, from_me: false }] }
    queryClient.setQueryData<InfiniteData<MessagePage>>(['messages', CHAT], {
      pages: [{ items: [withReaction], has_more: false }],
      pageParams: [null],
    })
    const answer = deferred<FakeReply>()
    api.current.on('post', `${BASE}/messages/7/reaction`, () => answer.promise)
    const result = render(() => useReactToMessage(CHAT))

    act(() => result.current.mutate({ messageId: 7, emoji: MINE }))

    await waitFor(() => expect(thread()[0].reactions).toEqual([{ emoji: THEIRS, from_me: false }, { emoji: MINE, from_me: true }]))
    expect(api.current.calls('post', `${BASE}/messages/7/reaction`)[0]?.body).toEqual({ emoji: MINE })

    await act(async () => answer.resolve({ status: 500 }))
    await waitFor(() => expect(thread()[0].reactions).toEqual([{ emoji: THEIRS, from_me: false }]))
  })
})
