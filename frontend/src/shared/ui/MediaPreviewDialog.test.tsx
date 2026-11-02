import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { getCroppedImageFile } from '../utils/cropImage'
import { MediaPreviewDialog } from './MediaPreviewDialog'

vi.mock('react-easy-crop', async () => {
  const React = await import('react')
  return {
    default: function CropperMock({ onCropComplete }: { onCropComplete: (area: object, pixels: object) => void }) {
      const completed = React.useRef(false)
      React.useEffect(() => {
        if (completed.current) return
        completed.current = true
        onCropComplete(
          { x: 0, y: 0, width: 50, height: 50 },
          { x: 10, y: 20, width: 300, height: 300 },
        )
      }, [onCropComplete])
      return <div data-testid="cropper" />
    },
  }
})

vi.mock('../utils/cropImage', () => ({
  getCroppedImageFile: vi.fn(),
}))

describe('MediaPreviewDialog', () => {
  it('permite abrir, configurar y confirmar el recorte de una imagen', async () => {
    const user = userEvent.setup()
    const croppedFile = new File(['jpeg'], 'foto.jpg', { type: 'image/jpeg' })
    vi.mocked(getCroppedImageFile).mockResolvedValue(croppedFile)
    const onCropped = vi.fn()

    render(
      <MediaPreviewDialog
        previewUrl="blob:original"
        kind="image"
        filename="foto.png"
        onSend={vi.fn()}
        onCropped={onCropped}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Recortar imagen' }))

    expect(screen.getByRole('dialog', { name: 'Recortar foto' })).toBeInTheDocument()
    expect(screen.getByTestId('cropper')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Zoom' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1:1' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Rotar 90°' }))
    await user.click(screen.getByRole('button', { name: '1:1' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar recorte' }))

    await waitFor(() => expect(onCropped).toHaveBeenCalledWith(croppedFile))
    expect(getCroppedImageFile).toHaveBeenCalledWith(
      'blob:original',
      { x: 10, y: 20, width: 300, height: 300 },
      90,
      'foto.png',
    )
  })

  it('no ofrece recorte para videos', () => {
    render(
      <MediaPreviewDialog
        previewUrl="blob:video"
        kind="video"
        filename="video.mp4"
        onSend={vi.fn()}
        onCropped={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Recortar imagen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dibujar sobre la imagen' })).not.toBeInTheDocument()
  })

  it('abre las herramientas para dibujar sobre una imagen', async () => {
    const user = userEvent.setup()

    render(
      <MediaPreviewDialog
        previewUrl="blob:original"
        kind="image"
        filename="foto.png"
        onSend={vi.fn()}
        onCropped={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Dibujar sobre la imagen' }))

    expect(screen.getByRole('dialog', { name: 'Dibujar en la foto' })).toBeInTheDocument()
    expect(screen.getByLabelText('Lienzo para dibujar sobre la imagen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Color Rojo' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Grosor Medio' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Deshacer último trazo' })).toBeDisabled()
  })

  it('muestra nombre, tipo y tamaño antes de enviar un documento', () => {
    render(
      <MediaPreviewDialog
        previewUrl="blob:documento"
        kind="document"
        filename="consentimiento.pdf"
        contentType="application/pdf"
        fileSize={1_572_864}
        onSend={vi.fn()}
        onCropped={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getAllByText('consentimiento.pdf').length).toBeGreaterThan(0)
    expect(screen.getByText('PDF · 1.5 MB')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Documento seleccionado' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Recortar imagen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dibujar sobre la imagen' })).not.toBeInTheDocument()
  })

  it('con varios archivos, muestra la tira de miniaturas y "N archivos" en el título', () => {
    render(
      <MediaPreviewDialog
        previewUrl="blob:foto-1"
        kind="image"
        thumbnails={[
          { previewUrl: 'blob:foto-1', kind: 'image' },
          { previewUrl: 'blob:foto-2', kind: 'image' },
          { previewUrl: 'blob:video-1', kind: 'video' },
        ]}
        activeIndex={0}
        onSend={vi.fn()}
        onCropped={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('3 archivos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver archivo 1 de 3' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Ver archivo 2 de 3' })).not.toHaveAttribute('aria-current')
    expect(screen.getAllByRole('button', { name: /Sacar archivo \d del envío/ })).toHaveLength(3)
  })

  it('tocar una miniatura de la tira avisa al padre cuál está activa', async () => {
    const user = userEvent.setup()
    const onSelectThumbnail = vi.fn()

    render(
      <MediaPreviewDialog
        previewUrl="blob:foto-1"
        kind="image"
        thumbnails={[
          { previewUrl: 'blob:foto-1', kind: 'image' },
          { previewUrl: 'blob:foto-2', kind: 'image' },
        ]}
        activeIndex={0}
        onSelectThumbnail={onSelectThumbnail}
        onSend={vi.fn()}
        onCropped={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Ver archivo 2 de 2' }))
    expect(onSelectThumbnail).toHaveBeenCalledWith(1)
  })

  it('la X de una miniatura avisa al padre que la saque del lote', async () => {
    const user = userEvent.setup()
    const onRemoveThumbnail = vi.fn()

    render(
      <MediaPreviewDialog
        previewUrl="blob:foto-1"
        kind="image"
        thumbnails={[
          { previewUrl: 'blob:foto-1', kind: 'image' },
          { previewUrl: 'blob:foto-2', kind: 'image' },
        ]}
        activeIndex={0}
        onRemoveThumbnail={onRemoveThumbnail}
        onSend={vi.fn()}
        onCropped={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Sacar archivo 2 del envío' }))
    expect(onRemoveThumbnail).toHaveBeenCalledWith(1)
  })

  it('con un solo ítem en thumbnails, se comporta como el preview simple (sin tira)', () => {
    render(
      <MediaPreviewDialog
        previewUrl="blob:foto-1"
        kind="image"
        filename="foto.png"
        thumbnails={[{ previewUrl: 'blob:foto-1', kind: 'image' }]}
        activeIndex={0}
        onSend={vi.fn()}
        onCropped={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('foto.png')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ver archivo/ })).not.toBeInTheDocument()
  })
})
