/**
 * Acciones de la burbuja: editar, eliminar, reenviar y seleccionar.
 *
 * Lo que se cubre acá es la disponibilidad de cada acción —qué mensajes deja
 * tocar WhatsApp— y cómo queda un mensaje ya eliminado, ya editado o
 * reenviado. El envío en sí vive en los hooks; esto es la puerta que decide
 * si se ofrece.
 */

import { render, screen } from '@testing-library/react'
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
  selectionMode?: boolean
  isSelected?: boolean
}

function renderBubble(overrides: Partial<Message> = {}, options: Options = {}) {
  const onEdit = options.onEdit ?? vi.fn()
  const onForward = options.onForward ?? vi.fn()
  const onToggleSelect = options.onToggleSelect ?? vi.fn()
  const onRetry = options.onRetry ?? vi.fn()
  const onDiscard = options.onDiscard ?? vi.fn()
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
      onReact={vi.fn()}
      onEdit={onEdit}
      onDelete={vi.fn()}
      onForward={onForward}
      isDeleting={false}
      onSaveTemplate={vi.fn()}
      selectionMode={options.selectionMode ?? false}
      isSelected={options.isSelected ?? false}
      onToggleSelect={onToggleSelect}
    />,
  )
  return { onEdit, onForward, onToggleSelect, onRetry, onDiscard }
}

describe('MessageBubble', () => {
  it('ofrece editar y eliminar un mensaje propio de texto recién enviado', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderBubble()

    expect(screen.getByLabelText('Eliminar este mensaje para todos')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Editar este mensaje'))

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

  it('un envío descartado deja de ofrecer reintento', () => {
    renderBubble({ status: 'DISCARDED', wa_message_id: null })

    expect(screen.getByLabelText('No enviado, descartado')).toBeInTheDocument()
    expect(screen.queryByLabelText('No se pudo confirmar el envío. Reintentar')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Descartar el envío fallido')).not.toBeInTheDocument()
  })

  it('no ofrece editar pasados los 15 minutos, pero sí eliminar', () => {
    const sixteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000).toISOString()
    renderBubble({ sent_at: sixteenMinutesAgo })

    expect(screen.queryByLabelText('Editar este mensaje')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Eliminar este mensaje para todos')).toBeInTheDocument()
  })

  it('no ofrece editar un adjunto propio: WhatsApp solo edita texto', () => {
    renderBubble({ message_type: 'image', media_url: '/media/foto.jpg', content: 'Mirá' })

    expect(screen.queryByLabelText('Editar este mensaje')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Eliminar este mensaje para todos')).toBeInTheDocument()
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
    expect(link.getAttribute('href')).toMatch(/\/media\/nota\.ogg$/)
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

  it('no ofrece ni editar ni eliminar un mensaje del cliente', () => {
    renderBubble({ sender: 'cliente', content: 'Hola' })

    expect(screen.queryByLabelText('Editar este mensaje')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Eliminar este mensaje para todos')).not.toBeInTheDocument()
    // Responder y reaccionar sí siguen disponibles.
    expect(screen.getByLabelText('Responder a este mensaje')).toBeInTheDocument()
  })

  it('no ofrece acciones sobre un mensaje todavía sin confirmar en WhatsApp', () => {
    renderBubble({ wa_message_id: null, status: 'PENDING' })

    expect(screen.queryByLabelText('Editar este mensaje')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Eliminar este mensaje para todos')).not.toBeInTheDocument()
  })

  it('muestra la lápida de un mensaje eliminado, sin su contenido ni acciones', () => {
    // El backend ya no manda el texto de un eliminado; se replica acá.
    renderBubble({ content: null, deleted_at: '2026-08-06T12:00:00.000Z' })

    expect(screen.getByText('Eliminaste este mensaje')).toBeInTheDocument()
    expect(screen.queryByText('Te dejo el precio')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Responder a este mensaje')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Eliminar este mensaje para todos')).not.toBeInTheDocument()
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
    expect(screen.queryByLabelText('Seleccionar este mensaje')).not.toBeInTheDocument()
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
