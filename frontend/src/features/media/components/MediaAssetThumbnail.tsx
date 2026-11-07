/**
 * Miniatura de un archivo de la biblioteca, para listas donde hay que
 * reconocer el archivo sin abrirlo (describirlo para el asistente, elegirlo
 * para una plantilla). Imagen y video muestran su contenido, un PDF su
 * primera página; audio y el resto de documentos, un ícono tipado con la
 * extensión. Si la vista previa no carga, lo dice en vez de dejar un hueco.
 */
import { FileText, Film, Images, Music2, Play } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../../shared/utils/cn'
import { resolveMediaUrl } from '../../../shared/utils/mediaUrl'
import { formatMediaDuration, isPdfAsset, mediaAssetKind, mediaExtensionLabel } from '../domain/assets'
import { useImageThumbnail } from '../hooks/useImageThumbnail'
import type { MediaAsset, MediaAssetKind } from '../types'
import { PreviewLoading } from './PreviewLoading'
import { revealClass } from './revealClass'

const KIND_ICONS = { image: Images, video: Film, audio: Music2, document: FileText } as const

const pillClass = 'pointer-events-none absolute rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-white'

interface PreviewProps {
  asset: MediaAsset
  url: string
  /** El marco decide cuándo retirar el placeholder; el medio solo avisa. */
  loaded: boolean
  onLoad: () => void
  onError: () => void
  /** Un PDF no tiene original que mostrar como imagen. */
  fallbackToOriginal?: boolean
}

/** Miniatura reducida del backend, con vuelta al original si falla (ver useImageThumbnail). */
function ImagePreview({ asset, loaded, onLoad, onError, fallbackToOriginal }: PreviewProps) {
  const image = useImageThumbnail(asset.media_url, { onLoad, onFail: onError, fallbackToOriginal })
  // La primera página de un PDF se reconoce por su cabecera: se ancla arriba
  // en vez de centrar un recorte del medio de la hoja.
  const anchor = fallbackToOriginal === false ? 'object-top' : undefined
  return <img ref={image.ref} src={image.src} alt={asset.filename} loading="lazy" onLoad={image.onLoad} onError={image.onError} className={revealClass(loaded, anchor)} />
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
        className={revealClass(loaded, 'bg-black')}
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
  if (state === 'loading') return <PreviewLoading icon={Icon} />
  return (
    <span data-state={state} className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-wa-muted dark:text-wa-muted-dark">
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
  // Un PDF muestra su primera página; si el backend no pudo generarla, queda
  // el ícono con la extensión (no es un error: es un documento), y el visor
  // lo abre igual.
  const pdf = kind === 'document' && isPdfAsset(asset)
  const showsMedia = (kind === 'image' || kind === 'video' || pdf) && !failed
  const fail = () => setFailed(true)
  const load = useCallback(() => setLoaded(true), [])

  let content: ReactNode
  if (!showsMedia) content = <KindPlaceholder asset={asset} kind={kind} state={failed && !pdf ? 'failed' : 'ready'} />
  else {
    content = (
      <>
        {!loaded && <KindPlaceholder asset={asset} kind={kind} state="loading" />}
        {kind === 'video'
          ? <VideoPreview asset={asset} url={url} loaded={loaded} onLoad={load} onError={fail} />
          : <ImagePreview asset={asset} url={url} loaded={loaded} onLoad={load} onError={fail} fallbackToOriginal={!pdf} />}
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
