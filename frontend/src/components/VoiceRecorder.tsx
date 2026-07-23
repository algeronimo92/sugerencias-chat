import { useEffect, useRef, useState } from 'react'
import { Check, Mic, X } from 'lucide-react'

interface Props {
  disabled?: boolean
  onRecorded: (blob: Blob) => void
  onError: (message: string) => void
  onRecordingChange?: (isRecording: boolean) => void
}

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const s = (totalSeconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

/** getUserMedia falla con nombres de error específicos (DOMException.name);
 * cada uno tiene una causa y solución distinta, así que conviene explicarlas
 * por separado en vez de un "no se pudo acceder" genérico. */
function describeMicError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return (
      'El navegador tiene bloqueado el acceso al micrófono para este sitio. ' +
      'Para habilitarlo: hacé click en el ícono de candado (o de información) a la ' +
      'izquierda de la URL → "Permisos del sitio" → Micrófono → Permitir, y volvé a cargar la página.'
    )
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No se encontró ningún micrófono conectado a esta computadora.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'El micrófono está siendo usado por otra aplicación. Cerrala e intentá de nuevo.'
  }
  if (name === 'SecurityError') {
    return 'Grabar audio requiere una conexión segura (HTTPS) para este sitio.'
  }
  return 'No se pudo acceder al micrófono. Revisá los permisos del navegador para este sitio y volvé a cargar la página.'
}

export function VoiceRecorder({ disabled, onRecorded, onError, onRecordingChange }: Props) {
  const [isRecording, setIsRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const cancelledRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function cleanup() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    mediaRecorderRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    setSeconds(0)
    setIsRecording(false)
    onRecordingChange?.(false)
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      cancelledRef.current = false
      chunksRef.current = []

      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        if (!cancelledRef.current && chunksRef.current.length > 0) {
          onRecorded(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }))
        }
        cleanup()
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
      onRecordingChange?.(true)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch (err) {
      onError(describeMicError(err))
    }
  }

  function stopAndSend() {
    cancelledRef.current = false
    mediaRecorderRef.current?.stop()
  }

  function cancel() {
    cancelledRef.current = true
    mediaRecorderRef.current?.stop()
  }

  // Si se desmonta a mitad de una grabación (ej. el usuario cambia de chat),
  // no debe seguir grabando ni intentar mandar el audio a medio hacer.
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        cancelledRef.current = true
        mediaRecorderRef.current.stop()
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  if (isRecording) {
    return (
      <div className="flex-1 flex items-center gap-2 bg-wa-hover dark:bg-wa-head-dark border border-wa-border dark:border-wa-border-dark rounded-lg px-3 py-2">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
        <span className="text-sm text-gray-600 dark:text-gray-300 tabular-nums">{formatElapsed(seconds)}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancelar grabación"
          className="text-wa-muted hover:text-red-500 dark:hover:text-red-400 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={stopAndSend}
          aria-label="Enviar audio"
          className="w-7 h-7 flex items-center justify-center rounded-full bg-wa-primary text-white hover:bg-wa-primary-strong transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={startRecording}
      disabled={disabled}
      aria-label="Grabar audio"
      className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-wa-field dark:bg-wa-head-dark text-gray-600 dark:text-gray-300 hover:bg-wa-border dark:hover:bg-wa-active-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <Mic className="w-4 h-4" />
    </button>
  )
}
