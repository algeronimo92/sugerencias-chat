import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'

import { useMe } from '../../shared/auth'
import { acceptCall, confirmCallConnected, dismissCall, fetchCallAnswer, fetchCallOffer, fetchRingingCalls, startCall, terminateCall } from './api'
import { IDLE, browserCause, reduceSession, type EndReason } from './domain/callSession'
import { answerOffer, createOffer, onRemoteAudio, type DtlsRole } from './domain/webrtc'
import { CALL_ENDED_EVENT, CallCenterContext as Context, type CallCenter } from './callCenterContext'
import { callKeys } from './keys'
import { startRingtone } from './ringtone'
import type { Call } from './types'

/** El aviso en vivo puede fallar sin que el navegador lo note (el bus entre
 *  procesos descarta avisos y la conexión puede quedar sorda): con 30 a 60 s
 *  de timbre, consultar cada 10 s asegura que suene igual. */
const RINGING_POLL_MS = 10_000
/** Pasado esto sin audio, la llamada se da por no conectada. */
const CONNECT_TIMEOUT_MS = 8_000
const ENDED_NOTICE_MS = 4_000

/** Identifica esta pestaña: una persona puede tener el CRM abierto en varias. */
const CLIENT_ID = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2)

/** Opciones a confirmar con una llamada real (fase 0 del plan). Se leen de
 *  localStorage para poder cambiarlas en una prueba sin desplegar. */
function trialOptions(): { role: DtlsRole; preAccept: boolean } {
  try {
    const role = localStorage.getItem('calls.dtlsRole')
    return {
      role: role === 'active' || role === 'passive' ? role : 'auto',
      preAccept: localStorage.getItem('calls.preAccept') === '1',
    }
  } catch {
    return { role: 'auto', preAccept: false }
  }
}

export function CallCenterProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe()
  const enabled = Boolean(me?.can_handle_calls)
  const queryClient = useQueryClient()
  const [session, dispatch] = useReducer(reduceSession, IDLE)
  const sessionRef = useRef(session)
  sessionRef.current = session

  const connection = useRef<RTCPeerConnection | null>(null)
  const microphone = useRef<MediaStream | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)

  const { data: ringingAll = [] } = useQuery({
    queryKey: callKeys.ringing,
    queryFn: fetchRingingCalls,
    enabled,
    refetchInterval: RINGING_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })
  // La que esta pestaña está atendiendo ya no "suena".
  const busyId = session.phase === 'connecting' || session.phase === 'active' ? session.call.id : null
  const ringing = useMemo(() => ringingAll.filter(call => call.id !== busyId), [ringingAll, busyId])

  const release = useCallback(() => {
    connection.current?.close()
    connection.current = null
    microphone.current?.getTracks().forEach(track => track.stop())
    microphone.current = null
    if (audio.current) audio.current.srcObject = null
    void wakeLock.current?.release().catch(() => {})
    wakeLock.current = null
  }, [])

  const finish = useCallback((reason: EndReason, { tellBackend }: { tellBackend: boolean }) => {
    const current = sessionRef.current
    if (current.phase !== 'connecting' && current.phase !== 'active') return
    release()
    dispatch({ type: 'end', reason, at: Date.now() })
    if (tellBackend) void terminateCall(current.call.id, browserCause(reason)).catch(() => {})
    void queryClient.invalidateQueries({ queryKey: callKeys.all })
  }, [queryClient, release])

  const answer = useCallback((call: Call) => {
    if (sessionRef.current.phase === 'connecting' || sessionRef.current.phase === 'active') return
    dispatch({ type: 'answer', call: { id: call.id, chatId: call.chat_id, callerName: call.caller_name ?? null } })
    void (async () => {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        // No se le avisa a Meta: la llamada sigue sonando para los demás.
        dispatch({ type: 'end', reason: 'microphone_blocked', at: Date.now() })
        return
      }
      microphone.current = stream
      try {
        const { role, preAccept } = trialOptions()
        const offer = await fetchCallOffer(call.id)
        const answered = await answerOffer(offer, stream, role)
        connection.current = answered.connection
        onRemoteAudio(answered.connection, (remote) => {
          if (audio.current) audio.current.srcObject = remote
        })
        answered.connection.addEventListener('connectionstatechange', () => {
          const state = answered.connection.connectionState
          const current = sessionRef.current
          if (state === 'connected') {
            if (current.phase === 'connecting') {
              dispatch({ type: 'connected', at: Date.now() })
              // Por si Meta no llegó a responder el atender: hay audio, es nuestra.
              void confirmCallConnected(call.id).catch(() => {})
            } else {
              dispatch({ type: 'unstable', unstable: false })
            }
          } else if (state === 'disconnected') {
            dispatch({ type: 'unstable', unstable: true })
          } else if (state === 'failed') {
            finish(current.phase === 'active' ? 'dropped' : 'no_audio', { tellBackend: true })
          }
        })
        await acceptCall(call.id, { sdp: answered.sdp, client_id: CLIENT_ID, pre_accept: preAccept })
        try {
          wakeLock.current = await (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null
        } catch {
          // Sin bloqueo de pantalla la llamada funciona igual.
        }
        setTimeout(() => {
          if (sessionRef.current.phase === 'connecting' && sessionRef.current.call.id === call.id) {
            finish('no_audio', { tellBackend: true })
          }
        }, CONNECT_TIMEOUT_MS)
      } catch {
        // Otra persona la atendió antes, el cliente colgó o Meta la rechazó.
        release()
        dispatch({ type: 'end', reason: 'rejected', at: Date.now() })
        void queryClient.invalidateQueries({ queryKey: callKeys.ringing })
      }
    })()
  }, [finish, queryClient, release])

  const call = useCallback((chatId: string, name: string | null) => {
    if (sessionRef.current.phase === 'connecting' || sessionRef.current.phase === 'active') return
    dispatch({ type: 'answer', call: { id: 0, chatId, callerName: name }, outbound: true })
    void (async () => {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        dispatch({ type: 'end', reason: 'microphone_blocked', at: Date.now() })
        return
      }
      microphone.current = stream
      let callId = 0
      try {
        const offered = await createOffer(stream)
        connection.current = offered.connection
        onRemoteAudio(offered.connection, (remote) => {
          if (audio.current) audio.current.srcObject = remote
        })
        offered.connection.addEventListener('connectionstatechange', () => {
          const state = offered.connection.connectionState
          const current = sessionRef.current
          if (state === 'connected') {
            dispatch(current.phase === 'connecting' ? { type: 'connected', at: Date.now() } : { type: 'unstable', unstable: false })
          } else if (state === 'disconnected') {
            dispatch({ type: 'unstable', unstable: true })
          } else if (state === 'failed') {
            finish(current.phase === 'active' ? 'dropped' : 'no_audio', { tellBackend: true })
          }
        })
        const placed = await startCall({ chat_id: chatId, sdp: offered.sdp, client_id: CLIENT_ID })
        callId = placed.id
        dispatch({ type: 'placed', callId })
      } catch {
        release()
        dispatch({ type: 'end', reason: 'not_allowed', at: Date.now() })
        void queryClient.invalidateQueries({ queryKey: callKeys.all })
        return
      }
      // La respuesta del cliente llega por el webhook: se consulta hasta
      // tenerla (el aviso en vivo puede perderse) o hasta que la llamada termine.
      let applied = false
      while (sessionRef.current.phase === 'connecting' || sessionRef.current.phase === 'active') {
        // Por chat y no por id: el id nuevo tarda un render en llegar a la referencia.
        if (sessionRef.current.call.chatId !== chatId) return
        try {
          const state = await fetchCallAnswer(callId)
          if (state.sdp && !applied && connection.current) {
            applied = true
            await connection.current.setRemoteDescription({ type: 'answer', sdp: state.sdp })
          }
          if (state.call.status === 'rejected') { finish('customer_rejected', { tellBackend: false }); return }
          if (state.call.status === 'failed') {
            finish(state.call.cause === 'customer_no_answer' ? 'customer_no_answer' : 'no_audio', { tellBackend: false })
            return
          }
          if (state.call.status === 'completed') { finish('remote_ended', { tellBackend: false }); return }
        } catch {
          // Un pedido fallido no corta la llamada: se reintenta.
        }
        await new Promise(resolve => setTimeout(resolve, applied ? 4_000 : 1_500))
      }
    })()
  }, [finish, queryClient, release])

  const dismiss = useCallback((call: Call) => {
    queryClient.setQueryData<Call[]>(callKeys.ringing, current => (current ?? []).filter(item => item.id !== call.id))
    void dismissCall(call.id).catch(() => queryClient.invalidateQueries({ queryKey: callKeys.ringing }))
  }, [queryClient])

  const hangUp = useCallback(() => finish('hung_up', { tellBackend: true }), [finish])

  const toggleMute = useCallback(() => {
    const current = sessionRef.current
    if (current.phase !== 'active') return
    const muted = !current.muted
    microphone.current?.getAudioTracks().forEach((track) => { track.enabled = !muted })
    dispatch({ type: 'mute', muted })
  }, [])

  const clearEnded = useCallback(() => dispatch({ type: 'clear' }), [])

  // El backend avisó que la llamada de esta pestaña terminó (colgó el cliente).
  useEffect(() => {
    const onEnded = (event: Event) => {
      const callId = (event as CustomEvent<number>).detail
      const current = sessionRef.current
      if ((current.phase === 'connecting' || current.phase === 'active') && current.call.id === callId) {
        finish('remote_ended', { tellBackend: false })
      }
    }
    window.addEventListener(CALL_ENDED_EVENT, onEnded)
    return () => window.removeEventListener(CALL_ENDED_EVENT, onEnded)
  }, [finish])

  // Timbre mientras haya algo sonando y esta pestaña no esté en una llamada.
  const shouldRing = enabled && ringing.length > 0 && session.phase !== 'connecting' && session.phase !== 'active'
  useEffect(() => (shouldRing ? startRingtone() : undefined), [shouldRing])

  useEffect(() => {
    if (session.phase !== 'ended') return
    const timer = setTimeout(clearEnded, ENDED_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [session, clearEnded])

  useEffect(() => release, [release])

  const value = useMemo<CallCenter>(
    () => ({ enabled, ringing, session, answer, call, dismiss, hangUp, toggleMute, clearEnded }),
    [enabled, ringing, session, answer, call, dismiss, hangUp, toggleMute, clearEnded],
  )
  return (
    <Context.Provider value={value}>
      {children}
      {/* El audio del cliente. Fuera de cualquier pantalla: navegar no lo corta. */}
      <audio ref={audio} autoPlay className="hidden" />
    </Context.Provider>
  )
}
