import { useEffect, useRef, useState } from 'react'
import { Loader2, Play, Video } from 'lucide-react'

interface Props {
  src: string
  alt: string
  style?: React.CSSProperties
  className?: string
  footer: React.ReactNode
  onError?: () => void
  onOpenGallery: () => void
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const seconds = Math.floor(value)
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`
}

/** Video compacto de conversación: imita el mensaje de video de WhatsApp.
 * El reproductor completo se abre desde la galería, para que el hilo no
 * muestre la barra de controles del navegador ni acciones redundantes. */
export function ChatVideoMessage({ src, alt, style, className = '', footer, onError, onOpenGallery }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    setIsPlaying(false)
    setIsLoading(true)
    setDuration(0)
  }, [src])

  function syncMetadata() {
    const video = videoRef.current
    if (!video) return
    setDuration(Number.isFinite(video.duration) ? video.duration : 0)
    setIsLoading(false)
  }

  async function playOrPause() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      try {
        await video.play()
      } catch {
        setIsPlaying(false)
      }
      return
    }
    video.pause()
  }

  function handleSurfaceClick() {
    // Durante la reproducción, un toque sirve para pausar. En reposo, el
    // botón central inicia el video y el resto de la tarjeta abre la galería.
    if (isPlaying) {
      videoRef.current?.pause()
      return
    }
    onOpenGallery()
  }

  return (
    <div
      className={`group relative isolate overflow-hidden rounded-lg bg-black shadow-sm ${className}`}
      style={style}
      onClick={handleSurfaceClick}
      role="group"
      aria-label={`Video: ${alt}`}
    >
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        playsInline
        className="block h-full w-full bg-black object-contain"
        onLoadedMetadata={syncMetadata}
        onDurationChange={syncMetadata}
        onCanPlay={() => setIsLoading(false)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={() => { setIsLoading(false); onError?.() }}
      />

      {!isPlaying && (
        <button
          type="button"
          onClick={event => { event.stopPropagation(); void playOrPause() }}
          aria-label="Reproducir video"
          title="Reproducir video"
          className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur-[1px] transition-transform hover:scale-105"
        >
          {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Play className="ml-0.5 h-7 w-7 fill-current" />}
        </button>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/75 via-black/20 to-transparent px-2.5 pb-2 pt-9 text-[11px] font-medium text-white">
        <span onClick={event => event.stopPropagation()} className="inline-flex items-center gap-1 drop-shadow-sm"><Video className="h-3.5 w-3.5 fill-current" />{formatDuration(duration)}</span>
        <span onClick={event => event.stopPropagation()} className="inline-flex items-center gap-1 drop-shadow-sm">{footer}</span>
      </div>

      {isPlaying && <span className="sr-only">Video reproduciéndose</span>}
    </div>
  )
}
