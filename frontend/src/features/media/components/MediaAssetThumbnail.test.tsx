/**
 * La miniatura de una imagen pide la versión reducida del backend y, si esa
 * falla, vuelve al original antes de mostrar "Sin vista previa". El video
 * pide su primer cuadro y sigue abriendo el visor aunque no cargue.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
    ai_description: null,
    ...overrides,
  }
}

const video = asset({ filename: 'testimonio.mp4', content_type: 'video/mp4', media_url: '/media/testimonio.mp4', size_bytes: 1000, uploaded_by_name: 'Ana' })

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

  it('pide el primer cuadro del video para que Safari lo pinte, sin miniatura del backend', () => {
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
