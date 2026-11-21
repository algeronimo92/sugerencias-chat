/**
 * El lado del navegador de una llamada de WhatsApp: recibe la oferta de Meta
 * y arma la respuesta. El audio va directo entre el navegador y Meta; el
 * backend solo lleva estos dos textos.
 */

/** Rol de la conexión cifrada. La documentación de Meta muestra los dos, así
 *  que queda como opción hasta probarlo con una llamada real (fase 0, pregunta a). */
export type DtlsRole = 'auto' | 'active' | 'passive'

/** Meta no admite candidatos sueltos: la respuesta va completa, una sola vez. */
const GATHERING_TIMEOUT_MS = 2_500

export function withDtlsRole(sdp: string, role: DtlsRole): string {
  return role === 'auto' ? sdp : sdp.replace(/a=setup:(actpass|active|passive)/g, `a=setup:${role}`)
}

function gatheringComplete(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      connection.removeEventListener('icegatheringstatechange', check)
      clearTimeout(timer)
      resolve()
    }
    const check = () => { if (connection.iceGatheringState === 'complete') done() }
    const timer = setTimeout(done, GATHERING_TIMEOUT_MS)
    connection.addEventListener('icegatheringstatechange', check)
  })
}

export interface AnsweredOffer {
  connection: RTCPeerConnection
  sdp: string
}

/**
 * Entrega el audio del otro lado, también el que ya estaba en la conexión.
 *
 * Al atender, el navegador avisa la pista remota (`track`) mientras se aplica
 * la oferta de Meta, dentro de `answerOffer`: quien se suscribe después de
 * recibir la conexión ya se lo perdió. Así fallaron las primeras llamadas
 * entrantes reales (21-11-2026): conectaban y contaban la duración, pero en
 * el CRM no se oía al cliente. Las salientes sí, porque ahí la respuesta se
 * aplica después de suscribirse.
 */
export function onRemoteAudio(connection: RTCPeerConnection, play: (stream: MediaStream) => void): void {
  const tracks = connection.getReceivers().map(receiver => receiver.track).filter(track => track?.kind === 'audio')
  if (tracks.length) play(new MediaStream(tracks))
  connection.addEventListener('track', (event) => {
    play(event.streams[0] ?? new MediaStream([event.track]))
  })
}

/** Sin servidores STUN/TURN: Meta publica sus direcciones en la oferta y el
 *  navegador llega solo desde cualquier red doméstica o móvil. */
export async function answerOffer(offerSdp: string, microphone: MediaStream, role: DtlsRole = 'auto'): Promise<AnsweredOffer> {
  const connection = new RTCPeerConnection()
  try {
    microphone.getAudioTracks().forEach(track => connection.addTrack(track, microphone))
    await connection.setRemoteDescription({ type: 'offer', sdp: offerSdp })
    await connection.setLocalDescription(await connection.createAnswer())
    await gatheringComplete(connection)
    const sdp = connection.localDescription?.sdp
    if (!sdp) throw new Error('El navegador no generó la respuesta de audio')
    return { connection, sdp: withDtlsRole(sdp, role) }
  } catch (error) {
    connection.close()
    throw error
  }
}

/** Llamada saliente: el navegador hace la oferta y la respuesta del cliente
 *  llega después, por el backend. */
export async function createOffer(microphone: MediaStream): Promise<AnsweredOffer> {
  const connection = new RTCPeerConnection()
  try {
    microphone.getAudioTracks().forEach(track => connection.addTrack(track, microphone))
    await connection.setLocalDescription(await connection.createOffer())
    await gatheringComplete(connection)
    const sdp = connection.localDescription?.sdp
    if (!sdp) throw new Error('El navegador no generó la oferta de audio')
    return { connection, sdp }
  } catch (error) {
    connection.close()
    throw error
  }
}
