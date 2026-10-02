import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CameraCaptureDialog } from './CameraCaptureDialog'

function fakeStream(): { stream: MediaStream; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  return { stream, stop }
}

function mockMediaDevices(getUserMedia: ReturnType<typeof vi.fn>, videoInputs = 2) {
  const devices = Array.from({ length: videoInputs }, () => ({ kind: 'videoinput' }))
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: vi.fn().mockResolvedValue(devices),
    },
  })
}

describe('CameraCaptureDialog', () => {
  beforeEach(() => {
    // jsdom no hace layout ni decodifica video: sin estas dimensiones el
    // obturador no tendría de dónde sacar el frame.
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, value: 1280 })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, value: 720 })
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('captura un JPEG del video en vivo y lo entrega al compositor', async () => {
    const user = userEvent.setup()
    const { stream } = fakeStream()
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    mockMediaDevices(getUserMedia)

    const context = { translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['jpeg'], { type: 'image/jpeg' }))
    })

    const onCapture = vi.fn()
    render(<CameraCaptureDialog onCapture={onCapture} onClose={vi.fn()} />)

    const shutter = await screen.findByRole('button', { name: 'Tomar foto' })
    await waitFor(() => expect(shutter).toBeEnabled())
    // Arranca con la cámara trasera, que es la útil para fotografiar algo que
    // se le quiere mostrar al lead.
    expect(getUserMedia.mock.calls[0][0].video.facingMode).toEqual({ ideal: 'environment' })

    await user.click(shutter)

    await waitFor(() => expect(onCapture).toHaveBeenCalled())
    const file = onCapture.mock.calls[0][0] as File
    expect(file.type).toBe('image/jpeg')
    expect(file.name).toMatch(/^foto-\d{8}-\d{6}\.jpg$/)
    // La trasera no se espeja: solo la frontal invierte el lienzo.
    expect(context.scale).not.toHaveBeenCalled()
  })

  it('permite cambiar a la cámara frontal cuando hay más de una', async () => {
    const user = userEvent.setup()
    const first = fakeStream()
    const second = fakeStream()
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream)
    mockMediaDevices(getUserMedia)

    render(<CameraCaptureDialog onCapture={vi.fn()} onClose={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Cambiar de cámara' }))

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))
    expect(getUserMedia.mock.calls[1][0].video.facingMode).toEqual({ ideal: 'user' })
    // El stream anterior se apaga: dos cámaras abiertas a la vez dejan la luz
    // encendida y en el celular falla la segunda.
    expect(first.stop).toHaveBeenCalled()
  })

  it('apaga la cámara al cerrar el diálogo', async () => {
    const { stream, stop } = fakeStream()
    mockMediaDevices(vi.fn().mockResolvedValue(stream))

    const { unmount } = render(<CameraCaptureDialog onCapture={vi.fn()} onClose={vi.fn()} />)
    await screen.findByRole('button', { name: 'Tomar foto' })

    unmount()

    await waitFor(() => expect(stop).toHaveBeenCalled())
  })

  it('explica cómo desbloquear el permiso cuando el navegador lo niega', async () => {
    const denied = new DOMException('denied', 'NotAllowedError')
    mockMediaDevices(vi.fn().mockRejectedValue(denied))

    render(<CameraCaptureDialog onCapture={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText(/bloqueado el acceso a la cámara/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tomar foto' })).toBeDisabled()
  })
})
