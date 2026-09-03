/**
 * Acciones de la burbuja: editar, eliminar, reenviar y seleccionar.
 *
 * Lo que se cubre acá es la disponibilidad de cada acción —qué mensajes deja
 * tocar WhatsApp— y cómo queda un mensaje ya eliminado, ya editado o
 * reenviado. El envío en sí vive en los hooks; esto es la puerta que decide
 * si se ofrece.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Chat, Message } from '../types'
import { MessageBubble } from './MessageBubble'

const CHAT = { chat_id: 'lead-1', name: 'Ana Torres', phone: '51958334533' } as Chat

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    sender: 'vendedor',
    content: 'Te dejo el precio',
    // Recién enviado: dentro de la ventana de edición de WhatsApp.
    sent_at: new Date().toISOString(),
    media_url: null,
    wa_message_id: 'wa-1',
    status: 'READ',
    message_type: 'text',
    ...overrides,
  } as Message
}

interface Options {
  onEdit?: () => void
  onForward?: () => void
  onToggleSelect?: () => void
  onRetry?: () => void
  onDiscard?: () => void
  onDownload?: () => void
  onPin?: () => void
  onUnpin?: () => void
  selectionMode?: boolean
  isSelected?: boolean
  /** Otros mensajes del chat, para correlacionar pedidos de WhatsApp Flow
   * repartidos en varios mensajes. Por defecto, solo el propio mensaje. */
  chatMessages?: Message[]
}

function renderBubble(overrides: Partial<Message> = {}, options: Options = {}) {
  const onEdit = options.onEdit ?? vi.fn()
  const onForward = options.onForward ?? vi.fn()
  const onToggleSelect = options.onToggleSelect ?? vi.fn()
  const onRetry = options.onRetry ?? vi.fn()
  const onDiscard = options.onDiscard ?? vi.fn()
  const onDownload = options.onDownload ?? vi.fn()
  const onPin = options.onPin ?? vi.fn()
  const onUnpin = options.onUnpin ?? vi.fn()
  const m = message(overrides)
  render(
    <MessageBubble
      chat={CHAT}
      message={m}
      chatMessages={options.chatMessages ?? [m]}
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
      onReact={vi.fn()}
      onEdit={onEdit}
      onDelete={vi.fn()}
      onForward={onForward}
      onDownload={onDownload}
      isDeleting={false}
      onPin={onPin}
      onUnpin={onUnpin}
      onSaveTemplate={vi.fn()}
      selectionMode={options.selectionMode ?? false}
      isSelected={options.isSelected ?? false}
      onToggleSelect={onToggleSelect}
    />,
  )
  return { onEdit, onForward, onToggleSelect, onRetry, onDiscard, onDownload, onPin, onUnpin }
}

describe('MessageBubble', () => {
  it('muestra un pedido de WhatsApp con su estado, cantidad y total', () => {
    renderBubble({
      content: 'Pago: Realizado',
      message_type: 'order',
      payload: {
        order_id: '4VX5SPITUZD',
        title: 'Separación de cita',
        message: 'Pago: Realizado',
        item_count: 1,
        total_amount_1000: 50000,
        currency: 'PEN',
      },
    })

    expect(screen.getByText('Pedido N.º 4VX5SPITUZD')).toBeInTheDocument()
    expect(screen.getByText('Separación de cita')).toBeInTheDocument()
    expect(screen.getByText('Pago: Realizado')).toBeInTheDocument()
    expect(screen.getByText('Cantidad 1')).toBeInTheDocument()
    expect(screen.getByText('PEN 50.00')).toBeInTheDocument()
  })

  it('muestra un pedido de WhatsApp Flow como tarjeta, con el estado agregado del grupo', async () => {
    const user = userEvent.setup()
    const referenceId = '4W1G98HRIFB'
    const created = message({
      id: 1,
      content: 'Solicitud de pago: HIFU 12D - S/50.00',
      message_type: 'interactive',
      sent_at: '2026-08-01T10:00:00.000Z',
      payload: {
        buttons: [{
          name: 'review_and_pay', amount: 50, subtotal: 50, currency: 'PEN',
          reference_id: referenceId, order_status: 'payment_requested',
          item_name: 'HIFU 12D', quantity: 1,
        }],
      },
    })
    const paymentUpdate = message({
      id: 2,
      content: 'Pago: Realizado',
      message_type: 'interactive',
      sent_at: '2026-08-01T10:01:00.000Z',
      payload: { buttons: [{ name: 'payment_status', payment_status: 'captured', reference_id: referenceId }] },
    })
    const orderUpdate = message({
      id: 3,
      content: 'Estado: Completado',
      message_type: 'interactive',
      sent_at: '2026-08-01T10:02:00.000Z',
      payload: { buttons: [{ name: 'review_order', order_status: 'completed', reference_id: referenceId }] },
    })

    renderBubble(created, { chatMessages: [created, paymentUpdate, orderUpdate] })

    // No debe caer al chip "INTERACTIVO" + texto en cursiva del fallback genérico.
    expect(screen.queryByText('Interactivo')).not.toBeInTheDocument()
    expect(screen.getByText(`Pedido N.° ${referenceId}`)).toBeInTheDocument()
    expect(screen.getByText('HIFU 12D')).toBeInTheDocument()
    expect(screen.getByText('Cantidad: 1')).toBeInTheDocument()
    expect(screen.getByText('S/50.00')).toBeInTheDocument()
    // El badge usa el estado más reciente del grupo ("Completado"), no el
    // "Pendiente de pago" que trae su propio mensaje.
    expect(screen.getByText('Completado')).toBeInTheDocument()
    expect(screen.queryByText('Pendiente de pago')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ver detalles' }))
    const dialog = screen.getByRole('dialog', { name: 'Detalles del pedido' })
    expect(within(dialog).getByText('Subtotal')).toBeInTheDocument()
    expect(within(dialog).getByText('Total')).toBeInTheDocument()
  })

  it('muestra una actualización de pago del pedido como tarjeta compacta, sin "Ver detalles"', () => {
    const referenceId = '4W1G98HRIFB'
    const created = message({
      id: 1,
      message_type: 'interactive',
      sent_at: '2026-08-01T10:00:00.000Z',
      payload: {
        buttons: [{
          name: 'review_and_pay', amount: 50, currency: 'PEN', reference_id: referenceId,
          order_status: 'payment_requested', item_name: 'HIFU 12D', quantity: 1,
        }],
      },
    })
    const paymentUpdate = message({
      id: 2,
      content: 'Pago: Fallido',
      message_type: 'interactive',
      sent_at: '2026-08-01T10:01:00.000Z',
      payload: { buttons: [{ name: 'payment_status', payment_status: 'failed', reference_id: referenceId }] },
    })

    renderBubble(paymentUpdate, { chatMessages: [created, paymentUpdate] })

    // El propio mensaje no trae item_name/cantidad: se completan con el grupo.
    expect(screen.getByText('HIFU 12D')).toBeInTheDocument()
    expect(screen.getByText(/Cantidad 1/)).toBeInTheDocument()
    expect(screen.getByText('Pago: Fallido')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver detalles' })).not.toBeInTheDocument()
  })

  it('un mensaje interactivo que no calza con un pedido de WhatsApp Flow sigue el fallback de plantilla', () => {
    renderBubble({
      content: 'Elige un servicio',
      message_type: 'interactive',
      payload: { title: 'Servicios', body: 'Elige un servicio', options: [{ id: 'hifu', text: 'HIFU' }] },
    })

    expect(screen.getByText('Elige un servicio')).toBeInTheDocument()
    expect(screen.queryByText(/^Pedido N/)).not.toBeInTheDocument()
  })

  it('muestra un producto con precio normal y precio de oferta', () => {
    renderBubble({
      content: 'HIFU 12D',
      message_type: 'product',
      payload: {
        title: 'HIFU 12D', description: 'Tratamiento facial',
        price_amount_1000: 150000, sale_price_amount_1000: 120000, currency: 'PEN',
      },
    })
    expect(screen.getByText('HIFU 12D')).toBeInTheDocument()
    expect(screen.getByText('Tratamiento facial')).toBeInTheDocument()
    expect(screen.getByText('PEN 120.00')).toBeInTheDocument()
    expect(screen.getByText('PEN 150.00')).toHaveClass('line-through')
  })

  it('muestra una solicitud de pago con monto e identificador', () => {
    renderBubble({
      content: 'Separación de cita',
      message_type: 'payment',
      payload: {
        payment_kind: 'requestPayment', amount_1000: 50000, currency: 'PEN',
        note: 'Separación de cita', transaction_id: 'pay-1',
      },
    })
    expect(screen.getByText('Solicitud de pago')).toBeInTheDocument()
    expect(screen.getByText('PEN 50.00')).toBeInTheDocument()
    expect(screen.getByText('ID: pay-1')).toBeInTheDocument()
  })

  it('muestra view-once como aviso y nunca permite descargarlo', () => {
    renderBubble({
      sender: 'cliente',
      content: 'Solo para ti',
      message_type: 'view_once',
      payload: { original_type: 'viewOnceMessageV2', inner_type: 'image' },
      // Defensa ante una integración defectuosa: ni con URL debe descargarse.
      media_url: '/media/no-debe-descargarse.jpg',
    })

    expect(screen.getByText('Imagen de visualización única')).toBeInTheDocument()
    expect(screen.getByText(/Solo puede abrirse en WhatsApp/)).toBeInTheDocument()
    expect(screen.getByText('Solo para ti')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Descargar/)).not.toBeInTheDocument()
  })

  it('muestra resultados agregados de una encuesta', () => {
    renderBubble({
      sender: 'cliente', content: '¿Horario?', message_type: 'poll',
      payload: { values: ['AM', 'PM'], results: [{ option: 'AM', count: 2 }, { option: 'PM', count: 1 }] },
    })
    expect(screen.getByText('3 votos')).toBeInTheDocument()
    expect(screen.getByText('AM')).toBeInTheDocument()
    expect(screen.getByText('PM')).toBeInTheDocument()
  })

  it('ofrece editar y eliminar un mensaje propio de texto recién enviado', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderBubble()

    await user.click(screen.getByLabelText('Más acciones'))
    expect(screen.getByRole('menuitem', { name: 'Eliminar para todos' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Editar' }))

    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('un envío fallido ofrece reintentar y descartar', async () => {
    const user = userEvent.setup()
    const { onRetry, onDiscard } = renderBubble({ status: 'FAILED', wa_message_id: null })

    await user.click(screen.getByLabelText('No se pudo confirmar el envío. Reintentar'))
    await user.click(screen.getByLabelText('Descartar el envío fallido'))

    expect(onRetry).toHaveBeenCalledOnce()
    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it('un envío fallido con motivo real lo muestra en el tooltip, no el genérico', () => {
    const reason = 'La ventana de 24 h para responder libremente a este contacto está cerrada. Mandale una plantilla aprobada para reabrir la conversación.'
    renderBubble({ status: 'FAILED', wa_message_id: null, error_detail: reason })

    const retryButton = screen.getByLabelText(`No se pudo confirmar el envío: ${reason}. Reintentar`)
    expect(retryButton).toHaveAttribute('title', reason)
  })

  it('un envío descartado deja de ofrecer reintento', () => {
    renderBubble({ status: 'DISCARDED', wa_message_id: null })

    expect(screen.getByLabelText('No enviado, descartado')).toBeInTheDocument()
    expect(screen.queryByLabelText('No se pudo confirmar el envío. Reintentar')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Descartar el envío fallido')).not.toBeInTheDocument()
  })

  it('no ofrece editar pasados los 15 minutos, pero sí eliminar', async () => {
    const user = userEvent.setup()
    const sixteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000).toISOString()
    renderBubble({ sent_at: sixteenMinutesAgo })

    await user.click(screen.getByLabelText('Más acciones'))
    expect(screen.queryByRole('menuitem', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Eliminar para todos' })).toBeInTheDocument()
  })

  it('no ofrece editar un adjunto propio: WhatsApp solo edita texto', async () => {
    const user = userEvent.setup()
    renderBubble({ message_type: 'image', media_url: '/media/foto.jpg', content: 'Mirá' })

    await user.click(screen.getByLabelText('Más acciones'))
    expect(screen.queryByRole('menuitem', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Eliminar para todos' })).toBeInTheDocument()
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

  it('no ofrece ni editar ni eliminar un mensaje del cliente', async () => {
    const user = userEvent.setup()
    renderBubble({ sender: 'cliente', content: 'Hola' })

    await user.click(screen.getByLabelText('Más acciones'))
    expect(screen.queryByRole('menuitem', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Eliminar para todos' })).not.toBeInTheDocument()
    // Fijar sí (no depende de quién mandó el mensaje).
    expect(screen.getByRole('menuitem', { name: 'Fijar mensaje' })).toBeInTheDocument()
    // Responder y reaccionar sí siguen disponibles, sueltas.
    expect(screen.getByLabelText('Responder a este mensaje')).toBeInTheDocument()
  })

  it('no ofrece editar ni eliminar sobre un mensaje todavía sin confirmar en WhatsApp', async () => {
    const user = userEvent.setup()
    renderBubble({ wa_message_id: null, status: 'PENDING' })

    await user.click(screen.getByLabelText('Más acciones'))
    expect(screen.queryByRole('menuitem', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Eliminar para todos' })).not.toBeInTheDocument()
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
    renderBubble({ wa_message_id: null, status: 'PENDING' })

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

  it('en modo selección la burbuja se tilda al tocarla y esconde las acciones', async () => {
    const user = userEvent.setup()
    const { onToggleSelect } = renderBubble({}, { selectionMode: true })

    expect(screen.queryByLabelText('Responder a este mensaje')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Seleccionar mensaje' }))

    expect(onToggleSelect).toHaveBeenCalledOnce()
  })
})
