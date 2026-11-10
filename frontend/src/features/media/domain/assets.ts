/** Reglas puras sobre un archivo de la biblioteca: su tipo y cómo nombrarlo. */
import type { MediaAsset, MediaAssetKind } from '../types'

export const MEDIA_KIND_LABELS: Record<MediaAssetKind, string> = {
  image: 'Imagen',
  video: 'Video',
  audio: 'Audio',
  document: 'Documento',
}

export function mediaAssetKind(asset: Pick<MediaAsset, 'content_type'>): MediaAssetKind {
  if (asset.content_type.startsWith('image/')) return 'image'
  if (asset.content_type.startsWith('video/')) return 'video'
  if (asset.content_type.startsWith('audio/')) return 'audio'
  return 'document'
}

/** Un PDF tiene miniatura (su primera página) y se abre en el visor; el
 * resto de documentos solo se descargan o abren en otra pestaña. */
export function isPdfAsset(asset: Pick<MediaAsset, 'filename' | 'content_type'>): boolean {
  return asset.content_type === 'application/pdf' || /\.pdf$/i.test(asset.filename)
}

export function formatMediaSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('es-PE', { maximumFractionDigits: 1 })} MB`
}

export function formatMediaDuration(seconds: number): string {
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

/** "PDF", "DOCX"… a partir del nombre; si no tiene extensión, del tipo MIME. */
export function mediaExtensionLabel(asset: Pick<MediaAsset, 'filename' | 'content_type'>): string {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(asset.filename)?.[1]
  if (fromName) return fromName.toUpperCase()
  const subtype = asset.content_type.split('/')[1] ?? ''
  return subtype.replace(/^x-/, '').slice(0, 5).toUpperCase()
}
