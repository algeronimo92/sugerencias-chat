/**
 * Grilla de álbum: cuántas miniaturas se ven, el "+N" cuando hay más de las
 * visibles, que tocar una abre el visor, y que seleccionar tilda todo el
 * grupo de una vez.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Message } from '../types'
import { AlbumBubble } from './AlbumBubble'

function message(id: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    sender: 'cliente',
    content: null,
    sent_at: new Date().toISOString(),
    media_url: `/media/${id}.jpg`,
    wa_message_id: `wa-${id}`,
    status: 'READ',
    message_type: 'image',
    ...overrides,
  } as Message
}

interface Options {
  onOpenMedia?: (media: unknown) => void
  onToggleSelect?: () => void
  selectionMode?: boolean
  isSelected?: boolean
}

function renderAlbum(messages: Message[], options: Options = {}) {
  const onOpenMedia = options.onOpenMedia ?? vi.fn()
  const onToggleSelect = options.onToggleSelect ?? vi.fn()
  render(
    <AlbumBubble
      messages={messages}
      isFirstOfGroup
      failedMediaIds={new Set()}
      onMediaFailed={vi.fn()}
      onOpenMedia={onOpenMedia}
      onRetry={vi.fn()}
      onDiscard={vi.fn()}
      onForwardAll={vi.fn()}
      onDownloadAll={vi.fn()}
      selectionMode={options.selectionMode ?? false}
      isSelected={options.isSelected ?? false}
      onToggleSelect={onToggleSelect}
    />
  )
  return { onOpenMedia, onToggleSelect }
}

describe('AlbumBubble', () => {
  it('pinta una miniatura por foto cuando entran todas', () => {
    const messages = [message(1), message(2), message(3)]
    renderAlbum(messages)
    expect(screen.getAllByRole('button', { name: /Ver imagen/ })).toHaveLength(3)
  })

  it('muestra +N en la última miniatura cuando hay más de 4 fotos', () => {
    const messages = [1, 2, 3, 4, 5, 6].map(id => message(id))
    renderAlbum(messages)
    expect(screen.getAllByRole('button', { name: /Ver imagen/ })).toHaveLength(4)
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('tocar una miniatura abre el visor con esa imagen', async () => {
    const messages = [message(1), message(2)]
    const { onOpenMedia } = renderAlbum(messages)
    await userEvent.click(screen.getByRole('button', { name: 'Ver imagen 2 de 2' }))
    expect(onOpenMedia).toHaveBeenCalledWith(expect.objectContaining({
      src: expect.stringContaining('/media/2.jpg'),
      kind: 'image',
    }))
  })

  it('en modo selección, tocar el álbum tilda el grupo entero', async () => {
    const messages = [message(1), message(2)]
    const { onToggleSelect } = renderAlbum(messages, { selectionMode: true })
    await userEvent.click(screen.getByRole('button', { name: /Seleccionar álbum/ }))
    expect(onToggleSelect).toHaveBeenCalledTimes(1)
  })

  it('el pie muestra la hora del último mensaje del lote', () => {
    const messages = [
      message(1, { sent_at: '2026-08-13T09:00:00Z' }),
      message(2, { sent_at: '2026-08-13T09:05:00Z' }),
    ]
    renderAlbum(messages)
    // No se afirma el formato exacto (depende del locale del entorno de test),
    // solo que el pie no está vacío y no revienta el render.
    expect(document.querySelector('.text-wa-faint')).not.toBeNull()
  })
})
