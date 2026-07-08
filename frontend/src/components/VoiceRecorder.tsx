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
    } catch {
      onError('No se pudo acceder al micrófono')
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
      <div className="flex-1 flex items-center gap-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
        <span className="text-sm text-gray-600 dark:text-gray-300 tabular-nums">{formatElapsed(seconds)}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancelar grabación"
          className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={stopAndSend}
          aria-label="Enviar audio"
          className="w-7 h-7 flex items-center justify-center rounded-full bg-green-600 text-white hover:bg-green-700 transition-colors"
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
      className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <Mic className="w-4 h-4" />
    </button>
  )
}
