/**
 * Burbuja de un mensaje: cómo se pinta cada tipo de Meta y qué acciones ofrece.
 *
 * WhatsApp Cloud API no permite editar ni eliminar mensajes, así que la burbuja
 * solo ofrece responder, reaccionar, reenviar, fijar, descargar y seleccionar.
 * Las filas viejas editadas o eliminadas siguen pintándose como tales.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Chat } from '../types'
import type { Message } from '../../whatsapp/types'
import { MessageBubble } from './MessageBubble'

const CHAT = { chat_id: 'lead-1', name: 'Ana Torres', phone: '51958334533' } as Chat

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    sender: 'vendedor',
    content: 'Te dejo el precio',
    sent_at: new Date().toISOString(),
    media_url: null,
    wa_message_id: 'wamid.1',
    outbox_status: 'sent',
    meta_status: 'read',
    message_type: 'text',
    ...overrides,
  } as Message
}

interface Options {
  onForward?: () => void
  onToggleSelect?: () => void
  onRetry?: () => void
  onDiscard?: () => void
  onReact?: (emoji: string) => void
  onDownload?: () => void
  onPin?: () => void
  onUnpin?: () => void
  selectionMode?: boolean
  isSelected?: boolean
}

function renderBubble(overrides: Partial<Message> = {}, options: Options = {}) {
  const onForward = options.onForward ?? vi.fn()
  const onToggleSelect = options.onToggleSelect ?? vi.fn()
  const onRetry = options.onRetry ?? vi.fn()
  const onDiscard = options.onDiscard ?? vi.fn()
  const onReact = options.onReact ?? vi.fn()
  const onDownload = options.onDownload ?? vi.fn()
  const onPin = options.onPin ?? vi.fn()
  const onUnpin = options.onUnpin ?? vi.fn()
  render(
    <MessageBubble
      chat={CHAT}
      message={message(overrides)}
      isFirstOfGroup
      isFlashing={false}
      threadWidth={600}
      hasFailedMedia={false}
      onMediaFailed={vi.fn()}
      onOpenMedia={vi.fn()}
      onPreviewSticker={vi.fn()}
      onQuotedJump={vi.fn()}
      onRetry={onRetry}
      onDiscard={onDiscard}
      onStartReply={vi.fn()}
      onReact={onReact}
      onForward={onForward}
      onDownload={onDownload}
      onPin={onPin}
      onUnpin={onUnpin}
      onSaveTemplate={vi.fn()}
      selectionMode={options.selectionMode ?? false}
      isSelected={options.isSelected ?? false}
      onToggleSelect={onToggleSelect}
    />,
  )
  return { onForward, onToggleSelect, onRetry, onDiscard, onReact, onDownload, onPin, onUnpin }
}

describe('MessageBubble', () => {
  it('muestra un pedido de catálogo con sus productos y el total por moneda', () => {
    renderBubble({
      sender: 'cliente',
      content: 'Quiero esto',
      message_type: 'order',
      provider_payload: {
        order: {
          catalog_id: 'cat-1',
          text: 'Quiero esto',
          product_items: [
            { product_retailer_id: 'hifu-12d', quantity: 2, item_price: 25, currency: 'PEN' },
          ],
        },
      },
    })

    expect(screen.getByText('Pedido')).toBeInTheDocument()
    expect(screen.getByText('1 producto')).toBeInTheDocument()
    expect(screen.getByText('hifu-12d')).toBeInTheDocument()
    expect(screen.getByText('Quiero esto')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getAllByText(/^PEN 50[.,]00$/).length).toBeGreaterThan(0)
  })

  it('un interactivo de botones se pinta con encabezado, cuerpo y botones reales', () => {
    renderBubble({
      content: 'Hola Gerson lee esto',
      message_type: 'interactive',
      message_subtype: 'button',
      provider_payload: {
        interactive: {
          type: 'button',
          header: { type: 'text', text: 'Presiona un boton' },
          body: { text: 'Hola Gerson lee esto' },
          footer: { text: 'DermicaPro' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'reply_1', title: 'opcion a' } },
              { type: 'reply', reply: { id: 'reply_2', title: 'opcion b' } },
            ],
          },
        },
      },
    })

    expect(screen.getByText('Presiona un boton')).toBeInTheDocument()
    expect(screen.getByText('Hola Gerson lee esto')).toBeInTheDocument()
    expect(screen.getByText('opcion a')).toBeInTheDocument()
    expect(screen.getByText('opcion b')).toBeInTheDocument()
  })

  it('regresión OpcionA: la respuesta a un botón de plantilla muestra el texto elegido', () => {
    renderBubble({
      sender: 'cliente',
      content: 'OpcionA',
      message_type: 'button',
      provider_payload: { button: { text: 'OpcionA', payload: 'opcion_a' } },
    })

    expect(screen.getByText('OpcionA')).toBeInTheDocument()
  })

  it('la selección de una lista muestra el título elegido', () => {
    renderBubble({
      sender: 'cliente',
      content: 'HIFU',
      message_type: 'interactive',
      message_subtype: 'list_reply',
      provider_payload: {
        interactive: { type: 'list_reply', list_reply: { id: 'hifu', title: 'HIFU', description: 'Facial' } },
      },
    })

    expect(screen.getByText('HIFU')).toBeInTheDocument()
  })

  it('un tipo nuevo de Meta se muestra con su nombre literal en vez de ocultarse', () => {
    renderBubble({ sender: 'cliente', content: null, message_type: 'future_thing' })

    expect(screen.getByText(/future_thing/)).toBeInTheDocument()
  })

  it('un envío fallido ofrece reintentar y descartar', async () => {
    const user = userEvent.setup()
    const { onRetry, onDiscard } = renderBubble({ outbox_status: 'failed', meta_status: null, wa_message_id: null })

    await user.click(screen.getByLabelText('No se pudo confirmar el envío. Reintentar'))
    await user.click(screen.getByLabelText('Descartar el envío fallido'))

    expect(onRetry).toHaveBeenCalledOnce()
    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it('un envío fallido con motivo real lo muestra en el tooltip, no el genérico', () => {
    const reason = 'La ventana de 24 h para responder libremente a este contacto está cerrada. Mandale una plantilla aprobada para reabrir la conversación.'
    renderBubble({ outbox_status: 'failed', meta_status: null, wa_message_id: null, error_detail: reason })

    const retryButton = screen.getByLabelText(`${reason} Reintentar`)
    expect(retryButton).toHaveAttribute('title', reason)
  })

  it('un envío descartado deja de ofrecer reintento', () => {
    renderBubble({ outbox_status: 'discarded', meta_status: null, wa_message_id: null })

    expect(screen.getByLabelText('No enviado, descartado')).toBeInTheDocument()
    expect(screen.queryByLabelText('No se pudo confirmar el envío. Reintentar')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Descartar el envío fallido')).not.toBeInTheDocument()
  })

  it.each([
    ['sent', 'Enviado'],
    ['delivered', 'Entregado'],
    ['read', 'Leído'],
  ] as const)('muestra el estado literal de Meta %s', (metaStatus, label) => {
    renderBubble({ meta_status: metaStatus })
    expect(screen.getByLabelText(label)).toBeInTheDocument()
  })

  it('un fallo de entrega informado por Meta muestra el motivo y no ofrece reintento', () => {
    renderBubble({
      meta_status: 'failed',
      status_payload: { errors: [{ code: 131026, title: 'Message undeliverable' }] },
    })

    expect(screen.getByLabelText('Meta no pudo entregar este mensaje: Message undeliverable')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Reintentar/)).not.toBeInTheDocument()
  })

  it('no ofrece editar ni eliminar: WhatsApp Cloud API no lo permite', async () => {
    const user = userEvent.setup()
    renderBubble()

    await user.click(screen.getByLabelText('Más acciones'))
    expect(screen.queryByRole('menuitem', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Eliminar para todos' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Fijar mensaje' })).toBeInTheDocument()
  })

  it('ofrece fijar un mensaje sin fijar', async () => {
    const user = userEvent.setup()
    const { onPin, onUnpin } = renderBubble()

    await user.click(screen.getByLabelText('Más acciones'))
    await user.click(screen.getByRole('menuitem', { name: 'Fijar mensaje' }))

    expect(onPin).toHaveBeenCalledOnce()
    expect(onUnpin).not.toHaveBeenCalled()
  })

  it('ofrece desfijar un mensaje ya fijado', async () => {
    const user = userEvent.setup()
    const { onPin, onUnpin } = renderBubble({ pinned_at: '2026-08-28T10:00:00.000Z' })

    await user.click(screen.getByLabelText('Más acciones'))
    expect(screen.queryByRole('menuitem', { name: 'Fijar mensaje' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Desfijar mensaje' }))

    expect(onUnpin).toHaveBeenCalledOnce()
    expect(onPin).not.toHaveBeenCalled()
  })

  it('deja fijar un mensaje del cliente aunque no se le pueda editar ni eliminar', async () => {
    const user = userEvent.setup()
    renderBubble({ sender: 'cliente', content: 'Hola' })

    await user.click(screen.getByLabelText('Más acciones'))
    expect(screen.getByRole('menuitem', { name: 'Fijar mensaje' })).toBeInTheDocument()
  })

  it('no ofrece fijar un mensaje eliminado', () => {
    renderBubble({ content: null, deleted_at: '2026-08-06T12:00:00.000Z' })

    expect(screen.queryByLabelText('Más acciones')).not.toBeInTheDocument()
  })

  it('deja descargar un audio del chat con un nombre fechado', () => {
    renderBubble({
      sender: 'cliente',
      message_type: 'audio',
      media_url: '/media/nota.ogg',
      content: null,
      sent_at: '2026-08-06T12:05:00.000Z',
    })

    // Sin nombre propio (una nota de voz no lo trae), la fecha evita que dos
    // descargas se pisen en la carpeta del vendedor.
    const link = screen.getByLabelText('Descargar audio-2026-08-06_12-05.ogg')
    expect(link).toHaveAttribute('download', 'audio-2026-08-06_12-05.ogg')
    expect(link.getAttribute('href')).toMatch(/\/media\/nota\.ogg\?download=audio-2026-08-06_12-05\.ogg$/)
  })

  it('conserva el nombre original del audio cuando el mensaje lo trae', () => {
    renderBubble({
      sender: 'cliente',
      message_type: 'audio',
      media_url: '/media/abc123.mp3',
      content: null,
      payload: { filename: 'promo-hifu.mp3' },
    })

    expect(screen.getByLabelText('Descargar promo-hifu.mp3')).toHaveAttribute('download', 'promo-hifu.mp3')
  })

  it('ofrece descargar desde las acciones de cada multimedia', async () => {
    const user = userEvent.setup()
    const onDownload = vi.fn()
    renderBubble({ message_type: 'image', media_url: '/media/foto.jpg', content: 'Mirá' }, { onDownload })

    await user.click(screen.getByLabelText('Más acciones'))
    await user.click(screen.getByRole('menuitem', { name: 'Descargar' }))

    expect(onDownload).toHaveBeenCalledOnce()
  })

  it('muestra la lápida de un mensaje eliminado, sin su contenido ni acciones', () => {
    // El backend ya no manda el texto de un eliminado; se replica acá.
    renderBubble({ content: null, deleted_at: '2026-08-06T12:00:00.000Z' })

    expect(screen.getByText('Eliminaste este mensaje')).toBeInTheDocument()
    expect(screen.queryByText('Te dejo el precio')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Responder a este mensaje')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Más acciones')).not.toBeInTheDocument()
  })

  it('atribuye la lápida al cliente cuando el eliminado era suyo', () => {
    renderBubble({ sender: 'cliente', content: null, deleted_at: '2026-08-06T12:00:00.000Z' })

    expect(screen.getByText('Se eliminó este mensaje')).toBeInTheDocument()
  })

  it('marca como editado un mensaje reescrito', () => {
    renderBubble({ content: 'Te dejo el precio corregido', edited_at: '2026-08-06T12:05:00.000Z' })

    expect(screen.getByText('Editado')).toBeInTheDocument()
    expect(screen.getByText('Te dejo el precio corregido')).toBeInTheDocument()
  })

  it('ofrece reenviar un mensaje del cliente', async () => {
    const user = userEvent.setup()
    const { onForward } = renderBubble({ sender: 'cliente', content: 'Hola' })

    await user.click(screen.getByLabelText('Reenviar este mensaje'))

    expect(onForward).toHaveBeenCalledOnce()
  })

  it('deja reenviar un mensaje propio todavía sin confirmar: el contenido ya está guardado', () => {
    renderBubble({ wa_message_id: null, outbox_status: 'queued', meta_status: null })

    expect(screen.getByLabelText('Reenviar este mensaje')).toBeInTheDocument()
    // Responder sí necesita el id de WhatsApp del original.
    expect(screen.queryByLabelText('Responder a este mensaje')).not.toBeInTheDocument()
  })

  it('no ofrece reenviar ni seleccionar un mensaje eliminado', () => {
    renderBubble({ content: null, deleted_at: '2026-08-06T12:00:00.000Z' })

    expect(screen.queryByLabelText('Reenviar este mensaje')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Más acciones')).not.toBeInTheDocument()
  })

  it('marca como reenviado el mensaje que llegó de otro chat', () => {
    renderBubble({ payload: { forwarded: true } })

    expect(screen.getByText('Reenviado')).toBeInTheDocument()
  })

  it('agrupa varias reacciones y muestra quién puso cada una', async () => {
    const user = userEvent.setup()
    renderBubble({
      reactions: [
        { emoji: '👍', from_me: true },
        { emoji: '👍', from_me: false },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Ver 2 reacciones' }))

    const dialog = screen.getByRole('dialog', { name: '2 reacciones' })
    expect(within(dialog).getByText('Tú')).toBeInTheDocument()
    expect(within(dialog).getByText('Ana Torres')).toBeInTheDocument()
    expect(within(dialog).getAllByLabelText('Reaccionó con 👍')).toHaveLength(2)
  })

  it('permite quitar la reacción propia desde el detalle', async () => {
    const user = userEvent.setup()
    const onReact = vi.fn()
    renderBubble({ reactions: [{ emoji: '❤️', from_me: true }] }, { onReact })

    await user.click(screen.getByRole('button', { name: 'Ver 1 reacción' }))
    await user.click(screen.getByRole('button', { name: /Tú/ }))

    expect(onReact).toHaveBeenCalledWith('')
  })

  it('en modo selección la burbuja se tilda al tocarla y esconde las acciones', async () => {
    const user = userEvent.setup()
    const { onToggleSelect } = renderBubble({}, { selectionMode: true })

    expect(screen.queryByLabelText('Responder a este mensaje')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Seleccionar mensaje' }))

    expect(onToggleSelect).toHaveBeenCalledOnce()
  })
})
