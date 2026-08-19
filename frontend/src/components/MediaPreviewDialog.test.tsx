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
  })
})
