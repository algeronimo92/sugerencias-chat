/**
 * La miniatura de una imagen pide la versión reducida del backend y, si esa
 * falla, vuelve al original antes de mostrar "Sin vista previa".
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { MediaAsset } from '../types'
import { MediaAssetThumbnail } from './MediaAssetThumbnail'

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 1,
    filename: 'promo.png',
    media_url: '/media/promo.png',
    content_type: 'image/png',
    size_bytes: 1_700_000,
    uploaded_by_user_id: 1,
    uploaded_by_name: 'Admin',
    created_at: '2026-10-01T10:00:00Z',
    use_count: 0,
    ...overrides,
  }
}

describe('MediaAssetThumbnail', () => {
  it('pide la miniatura reducida y no el original', () => {
    render(<MediaAssetThumbnail asset={asset()} />)
    expect(screen.getByRole('img', { name: 'promo.png' })).toHaveAttribute('src', expect.stringMatching(/\/media\/promo\.png\/thumbnail$/))
  })

  it('vuelve al original si la miniatura no carga', () => {
    render(<MediaAssetThumbnail asset={asset()} />)
    const image = screen.getByRole('img', { name: 'promo.png' })

    fireEvent.error(image)

    expect(image).toHaveAttribute('src', expect.stringMatching(/\/media\/promo\.png$/))
    expect(screen.queryByText('Sin vista previa')).not.toBeInTheDocument()
  })

  it('avisa que no hay vista previa solo cuando tampoco carga el original', () => {
    render(<MediaAssetThumbnail asset={asset()} />)
    const image = screen.getByRole('img', { name: 'promo.png' })

    fireEvent.error(image)
    fireEvent.error(image)

    expect(screen.getByText('Sin vista previa')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('muestra el original directamente cuando no hay miniatura posible', () => {
    render(<MediaAssetThumbnail asset={asset({ media_url: 'data:image/png;base64,AAAA' })} />)
    expect(screen.getByRole('img', { name: 'promo.png' })).toHaveAttribute('src', 'data:image/png;base64,AAAA')
  })

  it('no pide miniaturas para los videos: el navegador pinta su primer cuadro', () => {
    const { container } = render(<MediaAssetThumbnail asset={asset({ filename: 'clip.mp4', media_url: '/media/clip.mp4', content_type: 'video/mp4' })} />)
    expect(container.querySelector('video')).toHaveAttribute('src', expect.stringMatching(/\/media\/clip\.mp4$/))
  })
})
