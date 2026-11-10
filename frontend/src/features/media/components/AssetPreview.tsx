/**
 * Lo que muestra cada tarjeta de la página Archivos: imagen y PDF con su
 * miniatura reducida (y el ícono del tipo pulsando mientras baja), video y
 * audio con su reproductor, el resto un ícono. Imagen y PDF se abren en el
 * visor al hacer clic.
 */
import { Eye, FileText, Images } from 'lucide-react'
import { useCallback, useState } from 'react'
import { AudioPlayer, VideoPlayer } from '../../../shared/ui/MediaPlayer'
import { resolveMediaUrl } from '../../whatsapp/public/message'
import { isPdfAsset } from '../domain/assets'
import { useImageThumbnail } from '../hooks/useImageThumbnail'
import type { MediaAsset } from '../types'
import { PreviewLoading } from './PreviewLoading'
import { revealClass } from './revealClass'

/** Imagen de la grilla: miniatura reducida con placeholder mientras baja. */
function ImageCard({ asset, onPreview }: { asset: MediaAsset; onPreview: () => void }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const onLoad = useCallback(() => setLoaded(true), [])
  const onFail = useCallback(() => setFailed(true), [])
  const image = useImageThumbnail(asset.media_url, { onLoad, onFail })
  if (failed) {
    return (
      <div className="flex h-44 flex-col items-center justify-center gap-2 bg-wa-hover text-wa-muted dark:bg-wa-panel-dark">
        <Images className="h-10 w-10 opacity-60" />
        <span className="text-xs font-semibold">Vista previa no disponible</span>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onPreview}
      aria-label={`Ver vista previa de ${asset.filename}`}
      className="group relative block h-44 w-full overflow-hidden bg-wa-hover text-left dark:bg-wa-panel-dark"
    >
      {!loaded && <PreviewLoading icon={Images} className="h-10 w-10" />}
      <img
        ref={image.ref}
        src={image.src}
        alt={asset.filename}
        loading="lazy"
        onLoad={image.onLoad}
        onError={image.onError}
        className={revealClass(loaded, 'transition-[opacity,transform] group-hover:scale-[1.03]')}
      />
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100 group-focus-visible:bg-black/30 group-focus-visible:opacity-100">
        <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold"><Eye className="h-4 w-4" />Vista previa</span>
      </span>
    </button>
  )
}

export function AssetPreview({ asset, onPreview }: { asset: MediaAsset; onPreview: () => void }) {
  const url = resolveMediaUrl(asset.media_url) ?? ''
  if (asset.content_type.startsWith('image/')) return <ImageCard asset={asset} onPreview={onPreview} />
  if (asset.content_type.startsWith('video/')) {
    return <VideoPlayer src={url} className="h-44 w-full" />
  }
  if (asset.content_type.startsWith('audio/')) {
    return (
      <div className="flex h-44 flex-col items-center justify-center gap-3 bg-violet-50 px-3 dark:bg-violet-950/20">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">Archivo de audio</span>
        <AudioPlayer src={url} className="w-full" downloadName={asset.filename} />
      </div>
    )
  }
  if (isPdfAsset(asset)) return <DocumentCard asset={asset} onPreview={onPreview} />
  return (
    <div className="flex h-44 items-center justify-center bg-wa-hover dark:bg-wa-panel-dark">
      <FileText className="h-12 w-12 text-wa-muted" />
    </div>
  )
}


/** Primera página del PDF; si el backend no pudo generarla, el ícono del documento, y el visor abre igual. */
function DocumentCard({ asset, onPreview }: { asset: MediaAsset; onPreview: () => void }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const onLoad = useCallback(() => setLoaded(true), [])
  const onFail = useCallback(() => setFailed(true), [])
  const image = useImageThumbnail(asset.media_url, { onLoad, onFail, fallbackToOriginal: false })
  return (
    <button
      type="button"
      onClick={onPreview}
      aria-label={`Ver ${asset.filename}`}
      className="group relative block h-44 w-full overflow-hidden bg-wa-hover text-left dark:bg-wa-panel-dark"
    >
      {failed
        ? <span className="flex h-full w-full items-center justify-center text-wa-muted"><FileText className="h-12 w-12" /></span>
        : (
          <>
            {!loaded && <PreviewLoading icon={FileText} className="h-10 w-10" />}
            <img ref={image.ref} src={image.src} alt="" loading="lazy" onLoad={image.onLoad} onError={image.onError} className={revealClass(loaded, 'object-top transition-[opacity,transform] group-hover:scale-[1.03]')} />
          </>
        )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100 group-focus-visible:bg-black/30 group-focus-visible:opacity-100">
        <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold"><Eye className="h-4 w-4" />Ver documento</span>
      </span>
    </button>
  )
}
