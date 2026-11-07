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

  it('pulsa el ícono de imagen mientras la miniatura baja y lo quita al cargar', () => {
    const { container } = render(<MediaAssetThumbnail asset={asset()} />)
    const image = screen.getByRole('img', { name: 'promo.png' })
    expect(container.querySelector('[data-state="loading"]')).toBeInTheDocument()
    expect(container.querySelector('[data-state="loading"] svg.lucide-images')).toBeInTheDocument()
    expect(image).toHaveClass('opacity-0')

    fireEvent.load(image)

    expect(container.querySelector('[data-state="loading"]')).not.toBeInTheDocument()
    expect(image).toHaveClass('opacity-100')
  })

  it('sigue mostrando el placeholder mientras reintenta con el original', () => {
    const { container } = render(<MediaAssetThumbnail asset={asset()} />)
    fireEvent.error(screen.getByRole('img', { name: 'promo.png' }))
    expect(container.querySelector('[data-state="loading"]')).toBeInTheDocument()
  })

  it('pulsa el ícono de video hasta que llegan los metadatos, y recién ahí muestra play y duración', () => {
    const { container } = render(<MediaAssetThumbnail asset={video} onOpen={vi.fn()} />)
    const element = container.querySelector('video')!
    expect(container.querySelector('[data-state="loading"] svg.lucide-film')).toBeInTheDocument()
    expect(screen.queryByText('0:12')).not.toBeInTheDocument()

    Object.defineProperty(element, 'duration', { value: 12, configurable: true })
    fireEvent.loadedMetadata(element)

    expect(container.querySelector('[data-state="loading"]')).not.toBeInTheDocument()
    expect(element).toHaveClass('opacity-100')
    expect(screen.getByText('0:12')).toBeInTheDocument()
  })

  it('audio y documentos sin miniatura muestran su ícono y extensión sin esperar nada', () => {
    const { container, rerender } = render(<MediaAssetThumbnail asset={asset({ filename: 'nota.ogg', content_type: 'audio/ogg', media_url: '/media/nota.ogg' })} />)
    expect(container.querySelector('[data-state="ready"] svg.lucide-music-2')).toBeInTheDocument()
    expect(screen.getByText('OGG')).toBeInTheDocument()

    rerender(<MediaAssetThumbnail asset={asset({ filename: 'informe.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', media_url: '/media/informe.docx' })} />)
    expect(container.querySelector('[data-state="ready"] svg.lucide-file-text')).toBeInTheDocument()
    expect(screen.getByText('DOCX')).toBeInTheDocument()
    expect(container.querySelector('[data-state="loading"]')).not.toBeInTheDocument()
  })

  it('un PDF pide su primera página y, si no la hay, queda el ícono del documento sin marcarlo como error', () => {
    const { container } = render(<MediaAssetThumbnail asset={asset({ filename: 'precios.pdf', content_type: 'application/pdf', media_url: '/media/precios.pdf' })} />)
    const page = screen.getByRole('img', { name: 'precios.pdf' })
    expect(page).toHaveAttribute('src', expect.stringMatching(/\/media\/precios\.pdf\/thumbnail$/))
    expect(container.querySelector('[data-state="loading"] svg.lucide-file-text')).toBeInTheDocument()

    fireEvent.error(page)

    expect(container.querySelector('[data-state="ready"] svg.lucide-file-text')).toBeInTheDocument()
    expect(screen.getByText('PDF')).toBeInTheDocument()
    expect(screen.queryByText('Sin vista previa')).not.toBeInTheDocument()
    // Nunca se intenta el original como imagen: un PDF no lo es.
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
