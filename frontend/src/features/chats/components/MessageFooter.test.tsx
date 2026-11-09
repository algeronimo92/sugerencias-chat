import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { formatMessageTime } from '../../whatsapp/public/message'
import { MessageFooter } from './MessageFooter'

const SENT_AT = '2026-11-09T15:05:00Z'
const EDITED_AT = '2026-11-09T15:09:00Z'

describe('MessageFooter', () => {
  it('muestra la hora con el tono legible del pie', () => {
    render(<MessageFooter sentAt={SENT_AT} />)
    const time = screen.getByText(formatMessageTime(SENT_AT))
    expect(time.parentElement).toHaveClass('text-xs', 'text-wa-faint-strong')
  })

  it('dice "Editado" y expone la hora de la edición como texto, no solo en el tooltip', () => {
    render(<MessageFooter sentAt={SENT_AT} editedAt={EDITED_AT} />)
    expect(screen.getByText('Editado')).toBeInTheDocument()
    expect(screen.getByText(`a las ${formatMessageTime(EDITED_AT)}`)).toHaveClass('sr-only')
  })

  it('el botón de guardar plantilla tiene nombre accesible, mide 24 px y llama al guardar', async () => {
    const onSaveTemplate = vi.fn()
    render(<MessageFooter sentAt={SENT_AT} onSaveTemplate={onSaveTemplate} />)
    const button = screen.getByRole('button', { name: 'Guardar como plantilla personal' })
    expect(button).toHaveClass('h-6', 'w-6')
    await userEvent.click(button)
    expect(onSaveTemplate).toHaveBeenCalledTimes(1)
  })

  it('sobre el video no impone color: hereda el blanco del degradado', () => {
    render(<MessageFooter sentAt={SENT_AT} overlay />)
    expect(screen.getByText(formatMessageTime(SENT_AT)).parentElement).not.toHaveClass('text-wa-faint-strong')
  })
})
