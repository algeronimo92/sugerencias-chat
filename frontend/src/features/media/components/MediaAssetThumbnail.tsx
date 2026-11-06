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
import { resolveMediaUrl } from '../../../shared/utils/mediaUrl'
import { formatMediaDuration, mediaAssetKind, mediaExtensionLabel } from '../domain/assets'
import type { MediaAsset } from '../types'

const KIND_ICONS = { image: Images, video: Film, audio: Music2, document: FileText } as const

const pillClass = 'pointer-events-none absolute rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-white'

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
  const [duration, setDuration] = useState<number | null>(null)
  const kind = mediaAssetKind(asset)
  const url = resolveMediaUrl(asset.media_url) ?? ''
  const Icon = KIND_ICONS[kind]
  const showsMedia = (kind === 'image' || kind === 'video') && !failed

  let content: ReactNode
  if (kind === 'image' && !failed) {
    content = <img src={url} alt={asset.filename} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
  } else if (kind === 'video' && !failed) {
    content = (
      <>
        <video
          src={url}
          preload="metadata"
          muted
          playsInline
          aria-label={asset.filename}
          onLoadedMetadata={event => setDuration(event.currentTarget.duration)}
          onError={() => setFailed(true)}
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
  } else {
    content = (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-wa-muted dark:text-wa-muted-dark">
        <Icon className="h-8 w-8" strokeWidth={1.5} aria-hidden="true" />
        {failed
          ? <span className="text-[10px] font-semibold">Sin vista previa</span>
          : <span className={`${pillClass} bottom-1.5 right-1.5`}>{mediaExtensionLabel(asset)}</span>}
      </span>
    )
  }

  const frameClass = cn(
    'relative block shrink-0 overflow-hidden rounded-lg bg-wa-field text-left outline-none dark:bg-wa-field-dark',
    (onOpen || href) && 'transition-shadow focus-visible:ring-2 focus-visible:ring-wa-primary/60 hover:ring-2 hover:ring-wa-primary/40',
    className ?? 'h-24 w-32',
  )

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" aria-label={`Abrir ${asset.filename} en otra pestaña`} className={frameClass}>
        {content}
      </a>
    )
  }
  if (onOpen && showsMedia) {
    return (
      <button ref={ref} type="button" onClick={onOpen} aria-label={`Ver ${asset.filename}`} className={frameClass}>
        {content}
      </button>
    )
  }
  return <span className={frameClass}>{content}</span>
})
