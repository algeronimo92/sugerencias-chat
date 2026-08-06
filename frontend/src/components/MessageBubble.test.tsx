/**
 * Editar y eliminar en la burbuja.
 *
 * Lo que se cubre acá es la disponibilidad de cada acción —qué mensajes deja
 * tocar WhatsApp— y cómo queda un mensaje ya eliminado o ya editado. El envío
 * en sí vive en los hooks; esto es la puerta que decide si se ofrece.
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

function renderBubble(overrides: Partial<Message> = {}, handlers: Partial<{ onEdit: () => void }> = {}) {
  const onEdit = handlers.onEdit ?? vi.fn()
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
      onRetry={vi.fn()}
      onStartReply={vi.fn()}
      onReact={vi.fn()}
      onEdit={onEdit}
      onDelete={vi.fn()}
      isDeleting={false}
      onSaveTemplate={vi.fn()}
    />,
  )
  return { onEdit }
}

describe('MessageBubble', () => {
  it('ofrece editar y eliminar un mensaje propio de texto recién enviado', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderBubble()

    expect(screen.getByLabelText('Eliminar este mensaje para todos')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Editar este mensaje'))

    expect(onEdit).toHaveBeenCalledOnce()
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
})
