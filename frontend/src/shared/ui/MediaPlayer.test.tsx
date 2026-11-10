import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AudioPlayer, VideoPlayer } from './MediaPlayer'

describe('MediaPlayer', () => {
  it('al desmontar el video, lo pausa y suelta el archivo', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause')
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load')
    const { container, unmount } = render(<VideoPlayer src="/media/clip.mp4" autoPlay />)
    const video = container.querySelector('video')!
    expect(video).toHaveAttribute('src', '/media/clip.mp4')

    unmount()

    // Safari sigue cargando un <video> quitado de la página y lo arranca al
    // terminar: sin src no queda nada que reproducir.
    expect(pause).toHaveBeenCalled()
    expect(video).not.toHaveAttribute('src')
    expect(load).toHaveBeenCalled()
  })

  it('al reproducir un audio pausa el resto de lo que suena', () => {
    const { container } = render(
      <>
        <AudioPlayer src="/media/uno.m4a" ariaLabel="Audio uno" />
        <AudioPlayer src="/media/dos.m4a" ariaLabel="Audio dos" />
      </>,
    )
    const [uno, dos] = Array.from(container.querySelectorAll('audio'))
    Object.defineProperty(uno, 'paused', { value: false, configurable: true })
    const pauseUno = vi.spyOn(uno, 'pause')

    fireEvent.play(dos)

    expect(pauseUno).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Pausar audio' })).toBeInTheDocument()
  })

  it('anuncia el progreso con el tiempo total', () => {
    const { container } = render(<AudioPlayer src="/media/uno.m4a" />)
    const audio = container.querySelector('audio')!
    Object.defineProperty(audio, 'duration', { value: 45, configurable: true })
    Object.defineProperty(audio, 'currentTime', { value: 12, configurable: true })
    fireEvent.loadedMetadata(audio)
    fireEvent.timeUpdate(audio)

    expect(screen.getByRole('slider', { name: 'Progreso del audio' })).toHaveAttribute('aria-valuetext', '0:12 de 0:45')
  })
})
