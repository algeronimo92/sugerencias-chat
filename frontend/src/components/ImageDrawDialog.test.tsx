import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageDrawDialog } from './ImageDrawDialog'

const context = {
  arc: vi.fn(),
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  fill: vi.fn(),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  restore: vi.fn(),
  save: vi.fn(),
  stroke: vi.fn(),
}

class ImageMock {
  crossOrigin = ''
  naturalWidth = 800
  naturalHeight = 600
  width = 800
  height = 600
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(_value: string) {
    queueMicrotask(() => this.onload?.())
  }
}

describe('ImageDrawDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', ImageMock)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['imagen-editada'], { type: 'image/jpeg' }))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Object.values(context).forEach((mock) => mock.mockClear())
  })

  it('dibuja, permite deshacer y entrega un JPEG compuesto', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <ImageDrawDialog
        imageUrl="blob:original"
        filename="captura.png"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    const canvas = screen.getByLabelText('Lienzo para dibujar sobre la imagen')
    const confirm = screen.getByRole('button', { name: 'Confirmar dibujo' })
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(canvas).toHaveAttribute('width', '800')
    expect(canvas).toHaveAttribute('height', '600')

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 20, clientY: 30 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 100, clientY: 120 })
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 100, clientY: 120 })

    const undo = screen.getByRole('button', { name: 'Deshacer último trazo' })
    expect(undo).toBeEnabled()
    expect(context.stroke).toHaveBeenCalled()

    await user.click(undo)
    expect(undo).toBeDisabled()

    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 40, clientY: 50 })
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 40, clientY: 50 })
    await user.click(confirm)

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    const editedFile = onConfirm.mock.calls[0][0] as File
    expect(editedFile).toMatchObject({ name: 'captura.jpg', type: 'image/jpeg' })
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92)
  })
})
