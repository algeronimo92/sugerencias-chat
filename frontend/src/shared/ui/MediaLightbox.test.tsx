import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { triggerMediaDownload } from '../utils/media'
import { MediaLightbox } from './MediaLightbox'

vi.mock('../utils/media', () => ({ triggerMediaDownload: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

describe('MediaLightbox', () => {
  it('descarga el elemento activo de la galería y permite cambiarlo', async () => {
    const user = userEvent.setup()
    render(
      <MediaLightbox
        src="/media/uno.jpg"
        kind="image"
        alt="Uno"
        filename="uno.jpg"
        items={[
          { src: '/media/uno.jpg', kind: 'image', alt: 'Uno', filename: 'uno.jpg' },
          { src: '/media/dos.mp4', kind: 'video', alt: 'Dos', filename: 'dos.mp4' },
        ]}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByLabelText('Siguiente multimedia'))
    await user.click(screen.getByLabelText('Descargar multimedia'))

    expect(triggerMediaDownload).toHaveBeenCalledWith('/media/dos.mp4', 'dos.mp4')
  })
})
