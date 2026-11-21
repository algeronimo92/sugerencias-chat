import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { onRemoteAudio } from './webrtc'

class FakeStream {
  tracks: unknown[]

  constructor(tracks: unknown[]) {
    this.tracks = tracks
  }
}

function connectionWith(receiverTracks: ({ kind: string } | null)[]) {
  const listeners: ((event: { streams: unknown[]; track: unknown }) => void)[] = []
  const connection = {
    getReceivers: () => receiverTracks.map(track => ({ track })),
    addEventListener: (type: string, listener: (event: { streams: unknown[]; track: unknown }) => void) => {
      if (type === 'track') listeners.push(listener)
    },
  } as unknown as RTCPeerConnection
  return { connection, announce: (event: { streams: unknown[]; track: unknown }) => listeners.forEach(listener => listener(event)) }
}

describe('onRemoteAudio', () => {
  beforeEach(() => vi.stubGlobal('MediaStream', FakeStream))
  afterEach(() => vi.unstubAllGlobals())

  it('al atender entrega la pista que el navegador ya había avisado', () => {
    // La oferta de Meta se aplica dentro de answerOffer: el evento `track`
    // ya pasó cuando el CRM recibe la conexión y se suscribe.
    const remote = { kind: 'audio' }
    const { connection } = connectionWith([remote])
    const play = vi.fn()

    onRemoteAudio(connection, play)

    expect(play).toHaveBeenCalledTimes(1)
    expect((play.mock.calls[0][0] as unknown as FakeStream).tracks).toEqual([remote])
  })

  it('en una saliente sin pista todavía, espera a que el navegador la avise', () => {
    const { connection, announce } = connectionWith([])
    const play = vi.fn()

    onRemoteAudio(connection, play)
    expect(play).not.toHaveBeenCalled()

    const stream = new FakeStream([{ kind: 'audio' }])
    announce({ streams: [stream], track: { kind: 'audio' } })
    expect(play).toHaveBeenCalledWith(stream)
  })

  it('una pista avisada sin flujo propio igual se reproduce', () => {
    const { connection, announce } = connectionWith([null])
    const play = vi.fn()
    const track = { kind: 'audio' }

    onRemoteAudio(connection, play)
    announce({ streams: [], track })

    expect(play).toHaveBeenCalledTimes(1)
    expect((play.mock.calls[0][0] as unknown as FakeStream).tracks).toEqual([track])
  })
})
