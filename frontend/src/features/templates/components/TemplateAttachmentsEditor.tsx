import { ArrowDown, ArrowUp, FileText, Film, FolderOpen, Image as ImageIcon, MessageSquareText, Music2, UploadCloud, X } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { MediaLibraryPicker } from '../../media/public/MediaLibraryPicker'
import type { MediaAsset } from '../../media/types'
import { resolveMediaUrl } from '../../whatsapp/public/message'
import { ACCEPTED_ATTACHMENT_TYPES, validateAttachmentFile } from '../domain/attachmentFiles'
import {
  MAX_TEMPLATE_ATTACHMENTS,
  captionIndex,
  draftContentType,
  draftFilename,
  moveDraft,
  type DraftAttachment,
} from '../domain/attachmentDraft'

const KINDS = [
  { prefix: 'image/', label: 'Imagen', icon: ImageIcon },
  { prefix: 'video/', label: 'Video', icon: Film },
  { prefix: 'audio/', label: 'Audio', icon: Music2 },
] as const

function kindOf(contentType: string) {
  return KINDS.find(kind => contentType.startsWith(kind.prefix)) ?? { label: 'Documento', icon: FileText }
}

let keySequence = 0
function newKey(prefix: string) {
  keySequence += 1
  return `${prefix}-${keySequence}`
}

/** La miniatura de un adjunto: la imagen misma, o el ícono de su tipo. Un
 *  archivo recién elegido todavía no tiene URL: se muestra desde el equipo. */
function Thumbnail({ item }: { item: DraftAttachment }) {
  const contentType = draftContentType(item)
  const [localUrl, setLocalUrl] = useState<string | null>(null)
  useEffect(() => {
    if (item.source !== 'upload' || !contentType.startsWith('image/')) return
    const url = URL.createObjectURL(item.file)
    setLocalUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [item, contentType])

  const remoteUrl = item.source === 'saved' ? item.attachment.media_url : item.source === 'library' ? item.asset.media_url : null
  const src = contentType.startsWith('image/') ? (localUrl ?? (remoteUrl ? resolveMediaUrl(remoteUrl) : null)) : null
  const { icon: Icon } = kindOf(contentType)
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-wa-border bg-wa-hover dark:border-wa-border-dark dark:bg-wa-head-dark">
      {src
        ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
        : <Icon className="h-5 w-5 text-wa-muted" aria-hidden="true" />}
    </span>
  )
}

interface Props {
  items: DraftAttachment[]
  onChange: (items: DraftAttachment[]) => void
  /** El texto de la plantilla: decide qué adjunto lo lleva como pie. */
  text: string
  onError: (message: string | null) => void
  disabled?: boolean
}

/**
 * Los archivos de una plantilla, apilados en el orden en que se envían
 * (2026-11-18). Inspirado en el armado por bloques de ManyChat y en el
 * «subir o elegir de la biblioteca» de respond.io y HubSpot: se agregan
 * desde el equipo, arrastrándolos o desde la biblioteca de medios, se
 * reordenan y se quitan. Marca cuál lleva el texto como pie, porque cambiar
 * el orden cambia el mensaje que recibe el cliente.
 */
export function TemplateAttachmentsEditor({ items, onChange, text, onError, disabled = false }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [picking, setPicking] = useState(false)
  const [dragging, setDragging] = useState(false)
  const available = MAX_TEMPLATE_ATTACHMENTS - items.length
  const withCaption = captionIndex(items, text)

  function addFiles(files: File[]) {
    const errors = files.map(validateAttachmentFile).filter((message): message is string => message != null)
    const valid = files.filter(file => validateAttachmentFile(file) == null)
    if (valid.length > available) errors.push(`Puedes agregar ${available} archivo${available === 1 ? '' : 's'} más (máximo ${MAX_TEMPLATE_ATTACHMENTS}).`)
    onError(errors.length ? errors.join('\n') : null)
    const added = valid.slice(0, Math.max(0, available)).map(file => ({ key: newKey('upload'), source: 'upload', file }) as const)
    if (added.length) onChange([...items, ...added])
  }

  function addFromLibrary(asset: MediaAsset) {
    if (available <= 0) return
    onError(null)
    onChange([...items, { key: newKey('library'), source: 'library', asset }])
    setPicking(false)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    if (!disabled) addFiles(Array.from(event.dataTransfer.files))
  }

  const usedAssetIds = new Set(items.flatMap(item => (
    item.source === 'library' ? [item.asset.id] : item.source === 'saved' && item.attachment.library_asset_id != null ? [item.attachment.library_asset_id] : []
  )))

  return (
    <section aria-labelledby="template-attachments-title" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="template-attachments-title" className="text-xs font-medium text-wa-muted dark:text-wa-muted-dark">Archivos</h3>
        <span className="text-xs tabular-nums text-wa-muted dark:text-wa-muted-dark">{items.length} de {MAX_TEMPLATE_ATTACHMENTS}</span>
      </div>

      {items.length > 0 && (
        <ol className="space-y-1.5" aria-label="Archivos en el orden en que se envían">
          {items.map((item, index) => {
            const filename = draftFilename(item)
            const kind = kindOf(draftContentType(item))
            return (
              <li key={item.key} className="flex items-center gap-3 rounded-xl border border-wa-border bg-white p-2 dark:border-wa-border-dark dark:bg-wa-panel-dark">
                <Thumbnail item={item} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={filename}>{filename}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-wa-muted dark:text-wa-muted-dark">
                    {kind.label}
                    {item.source !== 'saved' && <span className="rounded-full bg-wa-primary/10 px-1.5 py-px text-[10px] font-semibold text-wa-primary-strong dark:text-wa-primary">Nuevo</span>}
                    {index === withCaption && <span className="inline-flex items-center gap-1 rounded-full bg-wa-hover px-1.5 py-px text-[10px] font-semibold text-wa-text dark:bg-wa-head-dark dark:text-wa-text-dark"><MessageSquareText className="h-3 w-3" aria-hidden="true" />Lleva el texto</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={disabled || index === 0} aria-label={`Subir ${filename}`} title="Subir" onClick={() => onChange(moveDraft(items, index, -1))}><ArrowUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={disabled || index === items.length - 1} aria-label={`Bajar ${filename}`} title="Bajar" onClick={() => onChange(moveDraft(items, index, 1))}><ArrowDown className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-red-600 dark:hover:text-red-400" disabled={disabled} aria-label={`Quitar ${filename}`} title="Quitar" onClick={() => onChange(items.filter(other => other.key !== item.key))}><X className="h-4 w-4" /></Button>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {available > 0 && (
        <div
          onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-2 rounded-xl border border-dashed px-3 py-4 text-center transition-colors ${dragging
            ? 'border-wa-primary bg-wa-primary/5'
            : 'border-wa-border dark:border-wa-border-dark'}`}
        >
          <UploadCloud className="h-5 w-5 text-wa-muted" aria-hidden="true" />
          <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Arrastra archivos aquí o</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => fileInput.current?.click()}><UploadCloud className="h-3.5 w-3.5" />Subir archivo</Button>
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setPicking(true)}><FolderOpen className="h-3.5 w-3.5" />Elegir de la biblioteca</Button>
          </div>
          <input
            ref={fileInput} type="file" multiple accept={ACCEPTED_ATTACHMENT_TYPES} className="hidden"
            onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }}
          />
        </div>
      )}
      <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Se envían en este orden. Hasta 25 MB por archivo; videos, hasta 100 MB.</p>

      {picking && (
        <MediaLibraryPicker
          selectedIds={new Set()}
          disabledIds={usedAssetIds}
          canSelect={available > 0}
          onSelect={addFromLibrary}
          onClose={() => setPicking(false)}
        />
      )}
    </section>
  )
}
