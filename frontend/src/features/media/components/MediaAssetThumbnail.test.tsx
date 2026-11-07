import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MediaAsset } from '../types'
import { MediaAssetThumbnail } from './MediaAssetThumbnail'

const video: MediaAsset = {
  id: 1, filename: 'testimonio.mp4', content_type: 'video/mp4', media_url: '/media/testimonio.mp4',
  size_bytes: 1000, uploaded_by_user_id: 1, uploaded_by_name: 'Ana', created_at: '2026-10-01T10:00:00Z', use_count: 0, ai_description: null,
}

describe('MediaAssetThumbnail', () => {
  it('pide el primer cuadro del video para que Safari lo pinte', () => {
    const { container } = render(<MediaAssetThumbnail asset={video} onOpen={vi.fn()} />)
    expect(container.querySelector('video')).toHaveAttribute('src', expect.stringMatching(/\/media\/testimonio\.mp4#t=0\.001$/))
  })

  it('sigue abriendo el visor aunque la vista previa no cargue', () => {
    const onOpen = vi.fn()
    const { container } = render(<MediaAssetThumbnail asset={video} onOpen={onOpen} />)
    fireEvent.error(container.querySelector('video')!)

    expect(screen.getByText('Sin vista previa')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver testimonio.mp4' }))
    expect(onOpen).toHaveBeenCalled()
  })
})
