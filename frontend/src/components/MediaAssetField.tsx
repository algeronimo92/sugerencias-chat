import { useState } from 'react'
import { FolderOpen, Paperclip } from 'lucide-react'
import type { MediaAsset, MediaAssetKind, TemplateAttachment } from '../types'
import { resolveMediaUrl } from '../utils/message'
import { MediaLibraryPicker } from './MediaLibraryPicker'

export function AttachmentPreview({ attachment }: { attachment: TemplateAttachment | MediaAsset }) {
  const url = resolveMediaUrl(attachment.media_url) ?? ''
  if (attachment.content_type.startsWith('image/')) {
    return <img src={url} alt={attachment.filename} loading="lazy" className="h-16 w-16 rounded-lg border border-wa-border object-cover dark:border-wa-border-dark" />
  }
  if (attachment.content_type.startsWith('video/')) {
    return <video src={url} preload="metadata" className="h-16 w-16 rounded-lg border border-wa-border bg-black object-contain dark:border-wa-border-dark" />
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[9px] text-wa-muted dark:bg-wa-panel-dark">
    <Paperclip className="h-2.5 w-2.5" />{attachment.filename || attachment.content_type}
  </span>
}

/** Elegir un archivo ya subido a la librería de medios para acciones como
 *  "enviar audio" o "enviar solo adjunto" — sin subir nada nuevo desde acá. */
export function MediaAssetField({ mediaAssetId, mediaAssets, kind, onChange }: {
  mediaAssetId: number | null
  mediaAssets: MediaAsset[]
  kind?: MediaAssetKind
  onChange: (id: number) => void
}) {
  const [picking, setPicking] = useState(false)
  const selected = mediaAssets.find(asset => asset.id === mediaAssetId) ?? null
  return <div className="space-y-1.5">
    <button type="button" onClick={() => setPicking(true)} className="flex items-center gap-1.5 rounded-lg border border-wa-border px-3 py-2 text-xs font-semibold text-wa-muted hover:bg-wa-hover dark:border-wa-border-dark dark:hover:bg-wa-head-dark">
      <FolderOpen className="h-3.5 w-3.5" />{selected ? 'Cambiar archivo' : 'Elegir de la librería de medios'}
    </button>
    {selected && <div className="flex items-center gap-2">
      <AttachmentPreview attachment={selected} />
      <span className="min-w-0 flex-1 truncate text-[11px] text-wa-muted">{selected.filename}</span>
    </div>}
    {picking && <MediaLibraryPicker
      selectedIds={new Set(mediaAssetId ? [mediaAssetId] : [])}
      disabledIds={new Set()}
      canSelect
      defaultKind={kind}
      onSelect={asset => { onChange(asset.id); setPicking(false) }}
      onClose={() => setPicking(false)}
    />}
  </div>
}
