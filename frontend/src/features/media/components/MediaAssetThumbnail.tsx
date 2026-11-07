/**
 * Miniatura de un archivo de la biblioteca, para listas donde hay que
 * reconocer el archivo sin abrirlo (describirlo para el asistente, elegirlo
 * para una plantilla). Imagen y video muestran su contenido; audio y
 * documentos, un ícono tipado con la extensión. Si la vista previa no carga,
 * lo dice en vez de dejar un hueco.
 */
import { FileText, Film, Images, Music2, Play } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../../shared/utils/cn'
import { resolveMediaUrl, thumbnailUrl } from '../../../shared/utils/mediaUrl'
import { formatMediaDuration, mediaAssetKind, mediaExtensionLabel } from '../domain/assets'
import type { MediaAsset, MediaAssetKind } from '../types'

const KIND_ICONS = { image: Images, video: Film, audio: Music2, document: FileText } as const

const pillClass = 'pointer-events-none absolute rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-white'

// El medio nace invisible encima del placeholder y se revela con un fundido
// corto (200 ms, ease-out) al cargar: el usuario ve "esto está llegando" en
// vez de un rectángulo vacío que de golpe cambia de contenido. Con
// prefers-reduced-motion el fundido dura 0 (regla global en index.css).
const revealClass = (loaded: boolean) => cn('h-full w-full object-cover transition-opacity duration-200 ease-out', loaded ? 'opacity-100' : 'opacity-0')

interface PreviewProps {
  asset: MediaAsset
  url: string
  /** El marco decide cuándo retirar el placeholder; el medio solo avisa. */
  loaded: boolean
  onLoad: () => void
  onError: () => void
}

/**
 * Pide la miniatura del backend (unos KB) en vez del original: una lista de
 * 30 fotos bajaba decenas de MB. Si la miniatura falla (404 porque no se pudo
 * generar, backend viejo) se reintenta con el original antes de darse por
 * vencida.
 */
function ImagePreview({ asset, url, loaded, onLoad, onError }: PreviewProps) {
  const thumbnail = thumbnailUrl(asset.media_url)
  const [useOriginal, setUseOriginal] = useState(thumbnail === null)
  const ref = useRef<HTMLImageElement>(null)
  const src = useOriginal ? url : thumbnail ?? url
  // Una imagen que ya estaba en caché puede completarse antes de que React
  // enganche onLoad: sin esto el placeholder se quedaría pulsando para siempre.
  useEffect(() => {
    const image = ref.current
    if (image?.complete && image.naturalWidth > 0) onLoad()
  }, [src, onLoad])
  const handleError = () => {
    if (useOriginal) onError()
    else setUseOriginal(true)
  }
  return <img ref={ref} src={src} alt={asset.filename} loading="lazy" onLoad={onLoad} onError={handleError} className={revealClass(loaded)} />
}

/** Primer cuadro del video con ícono de play y, cuando se conoce, su duración. */
function VideoPreview({ asset, url, loaded, onLoad, onError }: PreviewProps) {
  const [duration, setDuration] = useState<number | null>(null)
  const ref = useRef<HTMLVideoElement>(null)
  // Se revela con los metadatos y no con loadeddata: con preload="metadata"
  // Safari no siempre dispara loadeddata, y el cuadro ya se ve gracias a #t.
  const reveal = useCallback((video: HTMLVideoElement) => {
    setDuration(video.duration)
    onLoad()
  }, [onLoad])
  useEffect(() => {
    const video = ref.current
    if (video && video.readyState >= 1) reveal(video)
  }, [url, reveal])
  return (
    <>
      <video
        ref={ref}
        // Safari no pinta ningún cuadro con preload="metadata" hasta que se
        // reproduce; pedir el instante 0.001 lo obliga a mostrar el primero.
        src={`${url}#t=0.001`}
        preload="metadata"
        muted
        playsInline
        aria-label={asset.filename}
        onLoadedMetadata={event => reveal(event.currentTarget)}
        onError={onError}
        className={cn(revealClass(loaded), 'bg-black')}
      />
      {loaded && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-black/65 text-white"><Play className="ml-0.5 h-4 w-4" fill="currentColor" /></span>
        </span>
      )}
      {loaded && duration !== null && Number.isFinite(duration) && (
        <span className={`${pillClass} bottom-1.5 right-1.5`}>{formatMediaDuration(duration)}</span>
      )}
    </>
  )
}

type PlaceholderState = 'loading' | 'ready' | 'failed'

/**
 * El ícono del tipo ocupa el marco en tres situaciones: mientras la imagen o
 * el video todavía bajan (pulsa, sin etiqueta: "esto está llegando"), para
 * audio y documentos que no tienen vista previa (fijo, con la extensión) y
 * cuando la vista previa no cargó (lo dice). Siempre el mismo ícono por tipo,
 * así la lista se reconoce antes de que llegue un solo byte de media.
 */
function KindPlaceholder({ asset, kind, state }: { asset: MediaAsset; kind: MediaAssetKind; state: PlaceholderState }) {
  const Icon = KIND_ICONS[kind]
  return (
    <span
      data-state={state}
      aria-hidden={state === 'loading' ? true : undefined}
      className={cn(
        'absolute inset-0 flex flex-col items-center justify-center gap-1 text-wa-muted dark:text-wa-muted-dark',
        state === 'loading' && 'animate-pulse motion-reduce:animate-none',
      )}
    >
      <Icon className="h-8 w-8" strokeWidth={1.5} aria-hidden="true" />
      {state === 'failed' && <span className="text-[10px] font-semibold">Sin vista previa</span>}
      {state === 'ready' && <span className={`${pillClass} bottom-1.5 right-1.5`}>{mediaExtensionLabel(asset)}</span>}
    </span>
  )
}

interface FrameProps {
  filename: string
  onOpen?: () => void
  href?: string
  className: string
  children: ReactNode
}

/** El marco decide cómo se abre el archivo: enlace, botón o nada. */
const ThumbnailFrame = forwardRef<HTMLButtonElement, FrameProps>(function ThumbnailFrame(
  { filename, onOpen, href, className, children },
  ref,
) {
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" aria-label={`Abrir ${filename} en otra pestaña`} className={className}>
        {children}
      </a>
    )
  }
  if (onOpen) {
    return (
      <button ref={ref} type="button" onClick={onOpen} aria-label={`Ver ${filename}`} className={className}>
        {children}
      </button>
    )
  }
  return <span className={className}>{children}</span>
})

interface Props {
  asset: MediaAsset
  /** Abre el archivo en un visor dentro de la app. */
  onOpen?: () => void
  /** Abre el archivo en otra pestaña (documentos y audios, que no tienen visor). */
  href?: string
  /** Dimensiones; por defecto 128×96. */
  className?: string
}

export const MediaAssetThumbnail = forwardRef<HTMLButtonElement, Props>(function MediaAssetThumbnail(
  { asset, onOpen, href, className },
  ref,
) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const kind = mediaAssetKind(asset)
  const url = resolveMediaUrl(asset.media_url) ?? ''
  const showsMedia = (kind === 'image' || kind === 'video') && !failed
  const fail = () => setFailed(true)
  const load = useCallback(() => setLoaded(true), [])

  let content: ReactNode
  if (!showsMedia) content = <KindPlaceholder asset={asset} kind={kind} state={failed ? 'failed' : 'ready'} />
  else {
    content = (
      <>
        {!loaded && <KindPlaceholder asset={asset} kind={kind} state="loading" />}
        {kind === 'image'
          ? <ImagePreview asset={asset} url={url} loaded={loaded} onLoad={load} onError={fail} />
          : <VideoPreview asset={asset} url={url} loaded={loaded} onLoad={load} onError={fail} />}
      </>
    )
  }

  const frameClass = cn(
    'relative block shrink-0 overflow-hidden rounded-lg bg-wa-field text-left outline-none dark:bg-wa-field-dark',
    (onOpen || href) && 'transition-shadow focus-visible:ring-2 focus-visible:ring-wa-primary/60 hover:ring-2 hover:ring-wa-primary/40',
    className ?? 'h-24 w-32',
  )

  // Aunque la miniatura no cargue, el visor sigue abriéndose: ahí el
  // reproductor completo avisa si el archivo de verdad no se puede ver.
  return (
    <ThumbnailFrame ref={ref} filename={asset.filename} href={href} onOpen={onOpen} className={frameClass}>
      {content}
    </ThumbnailFrame>
  )
})
