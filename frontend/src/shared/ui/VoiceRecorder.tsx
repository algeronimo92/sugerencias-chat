import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Pause, Play, Send, Trash2 } from 'lucide-react'

interface Props {
  disabled?: boolean
  onRecorded: (blob: Blob) => void
  onError: (message: string) => void
  onRecordingChange?: (isRecording: boolean) => void
}

type RecorderMode = 'idle' | 'requesting' | 'recording' | 'paused'

const WAVE_BAR_COUNT = 30
const WAVE_BASE_LEVEL = 0.08

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const seconds = (totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

function preferredMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined
  return [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ].find(type => MediaRecorder.isTypeSupported(type))
}

/** getUserMedia falla con nombres de error específicos (DOMException.name);
 * cada uno tiene una causa y solución distinta. */
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
  const [mode, setMode] = useState<RecorderMode>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [waveLevels, setWaveLevels] = useState(() => Array(WAVE_BAR_COUNT).fill(WAVE_BASE_LEVEL))
  const [hasSignal, setHasSignal] = useState(false)
  const [pausedAudioUrl, setPausedAudioUrl] = useState<string | null>(null)
  const [isReviewPlaying, setIsReviewPlaying] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const reviewAudioRef = useRef<HTMLAudioElement | null>(null)
  const pausedAudioUrlRef = useRef<string | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const discardOnStopRef = useRef(false)
  const sendOnStopRef = useRef(false)
  const createPausedPreviewRef = useRef(false)
  const mountedRef = useRef(true)

  function stopCaptureResources() {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (audioContextRef.current) void audioContextRef.current.close()
    audioContextRef.current = null
    mediaRecorderRef.current = null
  }

  function clearPausedPreview() {
    const audio = reviewAudioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
    }
    if (pausedAudioUrlRef.current) URL.revokeObjectURL(pausedAudioUrlRef.current)
    pausedAudioUrlRef.current = null
    setPausedAudioUrl(null)
    setIsReviewPlaying(false)
  }

  function resetToIdle() {
    clearPausedPreview()
    setElapsedMs(0)
    setWaveLevels(Array(WAVE_BAR_COUNT).fill(WAVE_BASE_LEVEL))
    setHasSignal(false)
    setMode('idle')
    onRecordingChange?.(false)
  }

  function startWaveform(stream: MediaStream) {
    try {
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.72
      context.createMediaStreamSource(stream).connect(analyser)
      audioContextRef.current = context
      void context.resume()
      const samples = new Uint8Array(analyser.fftSize)
      let lastPaint = 0

      const paint = (timestamp: number) => {
        const recorder = mediaRecorderRef.current
        if (!recorder || recorder.state === 'inactive') return
        if (recorder.state === 'recording' && timestamp - lastPaint >= 65) {
          lastPaint = timestamp
          analyser.getByteTimeDomainData(samples)
          let energy = 0
          for (const sample of samples) {
            const normalized = (sample - 128) / 128
            energy += normalized * normalized
          }
          const rms = Math.sqrt(energy / samples.length)
          const level = Math.min(1, Math.max(WAVE_BASE_LEVEL, rms * 8))
          setHasSignal(level > 0.14)
          setWaveLevels(current => [...current.slice(1), level])
        }
        animationFrameRef.current = requestAnimationFrame(paint)
      }
      animationFrameRef.current = requestAnimationFrame(paint)
    } catch {
      // La grabación sigue siendo válida aunque Web Audio no esté disponible.
      setWaveLevels(Array(WAVE_BAR_COUNT).fill(0.2))
    }
  }

  async function startRecording() {
    if (disabled || mode !== 'idle') return
    setMode('requesting')
    onError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop())
        return
      }

      streamRef.current = stream
      chunksRef.current = []
      discardOnStopRef.current = false
      sendOnStopRef.current = false
      createPausedPreviewRef.current = false
      const mimeType = preferredMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
        if (createPausedPreviewRef.current) {
          createPausedPreviewRef.current = false
          if (!mountedRef.current) return
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || mimeType || 'audio/webm',
          })
          if (pausedAudioUrlRef.current) URL.revokeObjectURL(pausedAudioUrlRef.current)
          const url = URL.createObjectURL(blob)
          pausedAudioUrlRef.current = url
          if (mountedRef.current) setPausedAudioUrl(url)
        }
      }
      recorder.onerror = () => {
        onError('La grabación se interrumpió por un error del micrófono.')
        discardOnStopRef.current = true
        if (recorder.state !== 'inactive') recorder.stop()
      }
      recorder.onstop = () => {
        const shouldDiscard = discardOnStopRef.current
        const shouldSend = sendOnStopRef.current
        const chunks = [...chunksRef.current]
        const contentType = recorder.mimeType || mimeType || 'audio/webm'
        stopCaptureResources()
        if (!mountedRef.current) return
        setHasSignal(false)

        if (shouldDiscard || !shouldSend || chunks.length === 0) {
          resetToIdle()
          return
        }
        const blob = new Blob(chunks, { type: contentType })
        resetToIdle()
        onRecorded(blob)
      }

      mediaRecorderRef.current = recorder
      recorder.start(250)
      setElapsedMs(0)
      setWaveLevels(Array(WAVE_BAR_COUNT).fill(WAVE_BASE_LEVEL))
      setMode('recording')
      onRecordingChange?.(true)
      timerRef.current = setInterval(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          setElapsedMs(current => current + 100)
        }
      }, 100)
      startWaveform(stream)
    } catch (err) {
      stopCaptureResources()
      setMode('idle')
      onRecordingChange?.(false)
      onError(describeMicError(err))
    }
  }

  function pauseRecording() {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') return
    recorder.pause()
    clearPausedPreview()
    createPausedPreviewRef.current = true
    try {
      recorder.requestData()
    } catch {
      createPausedPreviewRef.current = false
    }
    setHasSignal(false)
    setMode('paused')
  }

  function resumeRecording() {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'paused') return
    createPausedPreviewRef.current = false
    clearPausedPreview()
    recorder.resume()
    setMode('recording')
  }

  function sendRecording() {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    reviewAudioRef.current?.pause()
    discardOnStopRef.current = false
    sendOnStopRef.current = true
    createPausedPreviewRef.current = false
    recorder.stop()
  }

  function discardRecording() {
    const recorder = mediaRecorderRef.current
    discardOnStopRef.current = true
    sendOnStopRef.current = false
    createPausedPreviewRef.current = false
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
      return
    }
    stopCaptureResources()
    resetToIdle()
  }

  async function togglePausedPlayback() {
    const audio = reviewAudioRef.current
    if (!audio || !pausedAudioUrl) return
    if (!audio.paused) {
      audio.pause()
      return
    }
    if (audio.ended) audio.currentTime = 0
    try {
      await audio.play()
    } catch {
      setIsReviewPlaying(false)
      onError('No se pudo reproducir la grabación. Intentá pausarla nuevamente.')
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      discardOnStopRef.current = true
      sendOnStopRef.current = false
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      stopCaptureResources()
      if (pausedAudioUrlRef.current) URL.revokeObjectURL(pausedAudioUrlRef.current)
      pausedAudioUrlRef.current = null
    }
  }, [])

  if (mode === 'requesting') {
    return (
      <div className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-wa-border bg-wa-hover px-3 text-xs text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark">
        <Loader2 className="h-4 w-4 animate-spin" /> Activando micrófono…
      </div>
    )
  }

  if (mode === 'recording' || mode === 'paused') {
    const paused = mode === 'paused'
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-wa-border bg-wa-hover px-2.5 py-1.5 dark:border-wa-border-dark dark:bg-wa-head-dark">
        <button type="button" onClick={discardRecording} aria-label="Descartar grabación" title="Descartar" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-wa-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 dark:hover:text-red-400">
          <Trash2 className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={paused ? togglePausedPlayback : pauseRecording}
          disabled={paused && !pausedAudioUrl}
          aria-label={paused ? (isReviewPlaying ? 'Pausar reproducción' : 'Reproducir grabación') : 'Pausar grabación'}
          title={paused ? (isReviewPlaying ? 'Pausar reproducción' : 'Escuchar lo grabado') : 'Pausar grabación'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-wa-primary-strong transition-colors hover:bg-wa-active disabled:cursor-wait disabled:opacity-55 dark:text-wa-primary dark:hover:bg-wa-active-dark"
        >
          {paused && !pausedAudioUrl
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : paused && !isReviewPlaying
              ? <Play className="h-4 w-4 fill-current" />
              : <Pause className="h-4 w-4 fill-current" />}
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${paused ? 'bg-wa-primary' : hasSignal ? 'animate-pulse bg-wa-primary' : 'bg-wa-muted/60'}`}
            title={paused ? 'Grabación pausada' : hasSignal ? 'El micrófono detecta audio' : 'Esperando señal de voz'}
          />
          <div className={`flex h-7 min-w-0 flex-1 items-center gap-[2px] overflow-hidden ${paused ? 'opacity-55' : ''}`} aria-hidden="true">
            {waveLevels.map((level, index) => (
              <span
                key={index}
                className={`min-w-[2px] flex-1 rounded-full transition-[height,background-color] duration-75 ${
                  paused ? 'bg-wa-muted' : hasSignal ? 'bg-wa-primary' : 'bg-wa-muted/70'
                }`}
                style={{ height: `${Math.max(3, Math.round(level * 26))}px` }}
              />
            ))}
          </div>
          <span className="shrink-0 text-sm font-medium tabular-nums text-wa-text dark:text-wa-text-dark">{formatElapsed(elapsedMs)}</span>
          <span className="sr-only" aria-live="polite">
            {paused ? 'Grabación pausada; podés escucharla, continuarla o enviarla' : hasSignal ? 'El micrófono detecta audio' : 'Esperando señal de voz'}
          </span>
        </div>

        {paused && (
          <button type="button" onClick={resumeRecording} aria-label="Continuar grabación" title="Continuar grabando" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-rose-500 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40">
            <Mic className="h-4 w-4" />
          </button>
        )}

        <button type="button" onClick={sendRecording} aria-label="Finalizar y enviar audio" title="Enviar audio" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wa-primary text-white shadow-sm transition-colors hover:bg-wa-primary-strong active:bg-wa-primary-deep">
          <Send className="h-4 w-4" />
        </button>

        {pausedAudioUrl && (
          <audio
            ref={reviewAudioRef}
            src={pausedAudioUrl}
            preload="auto"
            className="hidden"
            onPlay={() => setIsReviewPlaying(true)}
            onPause={() => setIsReviewPlaying(false)}
            onEnded={() => setIsReviewPlaying(false)}
          />
        )}
      </div>
    )
  }

  return (
    <button type="button" onClick={startRecording} disabled={disabled} aria-label="Grabar audio" title="Grabar audio" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-wa-field text-gray-600 transition-colors hover:bg-wa-border disabled:cursor-not-allowed disabled:opacity-50 dark:bg-wa-head-dark dark:text-gray-300 dark:hover:bg-wa-active-dark">
      <Mic className="h-4 w-4" />
    </button>
  )
}
