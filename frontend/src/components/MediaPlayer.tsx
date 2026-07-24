import { useEffect, useRef, useState } from 'react'
import { Expand, Loader2, Pause, Play, Volume2, VolumeX } from 'lucide-react'

type PlayerVariant = 'default' | 'bubble' | 'minimal'

interface BasePlayerProps {
  src: string
  className?: string
  onError?: () => void
  autoPlay?: boolean
  ariaLabel?: string
}

interface AudioPlayerProps extends BasePlayerProps {
  variant?: PlayerVariant
}

interface VideoPlayerProps extends BasePlayerProps {
  videoClassName?: string
  style?: React.CSSProperties
  onExpand?: () => void
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const totalSeconds = Math.floor(value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = (totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

function progressValue(currentTime: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(duration, Math.max(0, currentTime))
}

function AudioPlayButton({ isPlaying, isLoading, onClick, label }: { isPlaying: boolean; isLoading: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isLoading}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-wa-primary text-white shadow-sm transition-colors hover:bg-wa-primary-strong disabled:cursor-wait disabled:opacity-65"
    >
      {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isPlaying ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
    </button>
  )
}

export function AudioPlayer({ src, className = '', onError, autoPlay = false, ariaLabel = 'Reproductor de audio', variant = 'default' }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isMuted, setIsMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    setIsPlaying(false)
    setIsLoading(true)
    setCurrentTime(0)
    setDuration(0)
  }, [src])

  function syncMetadata() {
    const audio = audioRef.current
    if (!audio) return
    setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    setIsLoading(false)
  }

  async function togglePlayback() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      try {
        await audio.play()
      } catch {
        setIsPlaying(false)
      }
      return
    }
    audio.pause()
  }

  function seek(value: number) {
    const audio = audioRef.current
    if (!audio || !duration) return
    audio.currentTime = value
    setCurrentTime(value)
  }

  function toggleMute() {
    const audio = audioRef.current
    if (!audio) return
    audio.muted = !audio.muted
    setIsMuted(audio.muted)
  }

  const surfaces: Record<PlayerVariant, string> = {
    default: 'border border-wa-border bg-white shadow-sm dark:border-wa-border-dark dark:bg-wa-head-dark',
    bubble: 'border border-white/45 bg-white/55 dark:border-white/10 dark:bg-black/15',
    minimal: 'bg-transparent',
  }

  return (
    <div className={`flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 ${surfaces[variant]} ${className}`} role="group" aria-label={ariaLabel}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        autoPlay={autoPlay}
        className="hidden"
        onLoadedMetadata={syncMetadata}
        onDurationChange={syncMetadata}
        onCanPlay={() => setIsLoading(false)}
        onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => { setIsPlaying(false); setCurrentTime(duration) }}
        onError={() => { setIsLoading(false); onError?.() }}
      />
      <AudioPlayButton isPlaying={isPlaying} isLoading={isLoading} onClick={togglePlayback} label={isPlaying ? 'Pausar audio' : 'Reproducir audio'} />
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min="0"
          max={duration || 1}
          step="0.1"
          value={progressValue(currentTime, duration)}
          disabled={!duration}
          aria-label="Progreso del audio"
          onChange={event => seek(Number(event.target.value))}
          className="block h-1.5 w-full cursor-pointer accent-emerald-500 disabled:cursor-default disabled:opacity-45"
        />
        <div className="mt-1 flex justify-between text-[10px] font-medium tabular-nums text-wa-muted dark:text-wa-muted-dark">
          <span>{formatTime(currentTime)}</span>
          <span>{duration ? formatTime(duration) : '—:—'}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={toggleMute}
        aria-label={isMuted ? 'Activar sonido' : 'Silenciar audio'}
        title={isMuted ? 'Activar sonido' : 'Silenciar'}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-wa-muted transition-colors hover:bg-wa-field hover:text-wa-primary-strong dark:text-wa-muted-dark dark:hover:bg-wa-active-dark dark:hover:text-wa-primary"
      >
        {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

export function VideoPlayer({ src, className = '', videoClassName = '', style, onError, autoPlay = false, ariaLabel = 'Reproductor de video', onExpand }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isMuted, setIsMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    setIsPlaying(false)
    setIsLoading(true)
    setCurrentTime(0)
    setDuration(0)
  }, [src])

  function syncMetadata() {
    const video = videoRef.current
    if (!video) return
    setDuration(Number.isFinite(video.duration) ? video.duration : 0)
    setIsLoading(false)
  }

  async function togglePlayback() {
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

  function seek(value: number) {
    const video = videoRef.current
    if (!video || !duration) return
    video.currentTime = value
    setCurrentTime(value)
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setIsMuted(video.muted)
  }

  function openFullscreen() {
    const container = videoRef.current?.parentElement
    if (!container?.requestFullscreen) return
    void container.requestFullscreen().catch(() => undefined)
  }

  return (
    <div
      className={`group relative isolate overflow-hidden rounded-xl bg-black shadow-sm ${className}`}
      style={style}
      role="group"
      aria-label={ariaLabel}
      onClick={event => { event.stopPropagation(); void togglePlayback() }}
    >
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        autoPlay={autoPlay}
        playsInline
        className={`block h-full w-full bg-black object-contain ${videoClassName}`}
        onLoadedMetadata={syncMetadata}
        onDurationChange={syncMetadata}
        onCanPlay={() => setIsLoading(false)}
        onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => { setIsPlaying(false); setCurrentTime(duration) }}
        onError={() => { setIsLoading(false); onError?.() }}
      />

      {!isPlaying && (
        <button
          type="button"
          onClick={event => { event.stopPropagation(); void togglePlayback() }}
          aria-label="Reproducir video"
          title="Reproducir video"
          className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-wa-primary/95 text-white shadow-lg transition-transform hover:scale-105"
        >
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 fill-current" />}
        </button>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-2.5 pb-2 pt-8 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <button type="button" onClick={event => { event.stopPropagation(); void togglePlayback() }} aria-label={isPlaying ? 'Pausar video' : 'Reproducir video'} title={isPlaying ? 'Pausar' : 'Reproducir'} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-white/15">
          {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
        </button>
        <input
          type="range"
          min="0"
          max={duration || 1}
          step="0.1"
          value={progressValue(currentTime, duration)}
          disabled={!duration}
          aria-label="Progreso del video"
          onClick={event => event.stopPropagation()}
          onChange={event => seek(Number(event.target.value))}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-emerald-400 disabled:cursor-default disabled:opacity-45"
        />
        <span className="hidden shrink-0 text-[10px] font-medium tabular-nums sm:inline">{formatTime(currentTime)} / {duration ? formatTime(duration) : '—:—'}</span>
        <button type="button" onClick={event => { event.stopPropagation(); toggleMute() }} aria-label={isMuted ? 'Activar sonido' : 'Silenciar video'} title={isMuted ? 'Activar sonido' : 'Silenciar'} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-white/15">
          {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        {onExpand && <button type="button" onClick={event => { event.stopPropagation(); onExpand() }} aria-label="Agrandar video" title="Agrandar video" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-white/15"><Expand className="h-4 w-4" /></button>}
        <button type="button" onClick={event => { event.stopPropagation(); openFullscreen() }} aria-label="Pantalla completa" title="Pantalla completa" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-white/15"><Expand className="h-4 w-4" /></button>
      </div>
    </div>
  )
}
