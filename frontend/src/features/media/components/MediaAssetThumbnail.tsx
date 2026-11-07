/**
 * Miniatura de un archivo de la biblioteca, para listas donde hay que
 * reconocer el archivo sin abrirlo (describirlo para el asistente, elegirlo
 * para una plantilla). Imagen y video muestran su contenido; audio y
 * documentos, un ícono tipado con la extensión. Si la vista previa no carga,
 * lo dice en vez de dejar un hueco.
 */
import { FileText, Film, Images, Music2, Play } from 'lucide-react'
import { forwardRef, useState, type ReactNode } from 'react'
import { cn } from '../../../shared/utils/cn'
import { resolveMediaUrl, thumbnailUrl } from '../../../shared/utils/mediaUrl'
import { formatMediaDuration, mediaAssetKind, mediaExtensionLabel } from '../domain/assets'
import type { MediaAsset, MediaAssetKind } from '../types'

const KIND_ICONS = { image: Images, video: Film, audio: Music2, document: FileText } as const

const pillClass = 'pointer-events-none absolute rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-white'

interface PreviewProps {
  asset: MediaAsset
  url: string
  onError: () => void
}

/**
 * Pide la miniatura del backend (unos KB) en vez del original: una lista de
 * 30 fotos bajaba decenas de MB. Si la miniatura falla (404 porque no se pudo
 * generar, backend viejo) se reintenta con el original antes de darse por
 * vencida.
 */
function ImagePreview({ asset, url, onError }: PreviewProps) {
  const thumbnail = thumbnailUrl(asset.media_url)
  const [useOriginal, setUseOriginal] = useState(thumbnail === null)
  const src = useOriginal ? url : thumbnail ?? url
  const handleError = () => {
    if (useOriginal) onError()
    else setUseOriginal(true)
  }
  return <img src={src} alt={asset.filename} loading="lazy" onError={handleError} className="h-full w-full object-cover" />
}

/** Primer cuadro del video con ícono de play y, cuando se conoce, su duración. */
function VideoPreview({ asset, url, onError }: PreviewProps) {
  const [duration, setDuration] = useState<number | null>(null)
  return (
    <>
      <video
        // Safari no pinta ningún cuadro con preload="metadata" hasta que se
        // reproduce; pedir el instante 0.001 lo obliga a mostrar el primero.
        src={`${url}#t=0.001`}
        preload="metadata"
        muted
        playsInline
        aria-label={asset.filename}
        onLoadedMetadata={event => setDuration(event.currentTarget.duration)}
        onError={onError}
        className="h-full w-full bg-black object-cover"
      />
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-black/65 text-white"><Play className="ml-0.5 h-4 w-4" fill="currentColor" /></span>
      </span>
      {duration !== null && Number.isFinite(duration) && (
        <span className={`${pillClass} bottom-1.5 right-1.5`}>{formatMediaDuration(duration)}</span>
      )}
    </>
  )
}

/** Audio, documentos y cualquier vista previa que no cargó. */
function KindPlaceholder({ asset, kind, failed }: { asset: MediaAsset; kind: MediaAssetKind; failed: boolean }) {
  const Icon = KIND_ICONS[kind]
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-wa-muted dark:text-wa-muted-dark">
      <Icon className="h-8 w-8" strokeWidth={1.5} aria-hidden="true" />
      {failed
        ? <span className="text-[10px] font-semibold">Sin vista previa</span>
        : <span className={`${pillClass} bottom-1.5 right-1.5`}>{mediaExtensionLabel(asset)}</span>}
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
  const kind = mediaAssetKind(asset)
  const url = resolveMediaUrl(asset.media_url) ?? ''
  const showsMedia = (kind === 'image' || kind === 'video') && !failed
  const fail = () => setFailed(true)

  let content: ReactNode
  if (!showsMedia) content = <KindPlaceholder asset={asset} kind={kind} failed={failed} />
  else if (kind === 'image') content = <ImagePreview asset={asset} url={url} onError={fail} />
  else content = <VideoPreview asset={asset} url={url} onError={fail} />

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
