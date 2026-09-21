import { useDeferredValue, useState } from 'react'
import { Check, FileText, Film, FolderOpen, Images, Loader2, Music2, Search, X } from 'lucide-react'
import type { MediaAsset, MediaAssetKind } from '../types'
import { useMediaLibrary } from '../hooks/useMediaLibrary'
import { resolveMediaUrl } from '../utils/message'
import { DialogPrimitive as Dialog, dialogContentPositionClassElevated, dialogOverlayClassElevated } from './ui/Dialog'
interface Props {
  selectedIds: Set<number>
  disabledIds: Set<number>
  canSelect: boolean
  onSelect: (asset: MediaAsset) => void
  onClose: () => void
  defaultKind?: MediaAssetKind
}

const FILTERS: { value: MediaAssetKind | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'image', label: 'Imágenes' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audios' },
  { value: 'document', label: 'Documentos' },
]

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function AssetTile({ asset, selected, disabled, canSelect, onSelect }: {
  asset: MediaAsset
  selected: boolean
  disabled: boolean
  canSelect: boolean
  onSelect: (asset: MediaAsset) => void
}) {
  const [previewFailed, setPreviewFailed] = useState(false)
  const url = resolveMediaUrl(asset.media_url) ?? ''
  const isImage = asset.content_type.startsWith('image/')
  const isVideo = asset.content_type.startsWith('video/')
  const isAudio = asset.content_type.startsWith('audio/')
  const TypeIcon = isImage ? Images : isVideo ? Film : isAudio ? Music2 : FileText
  const typeLabel = isImage ? 'Imagen' : isVideo ? 'Video' : isAudio ? 'Audio' : 'Documento'
  const unavailable = !canSelect && !selected && !disabled

  return <button
    type="button"
    disabled={selected || disabled || !canSelect}
    onClick={() => onSelect(asset)}
    title={disabled ? 'Este archivo ya está en la plantilla' : selected ? 'Archivo seleccionado' : unavailable ? 'Se alcanzó el límite de adjuntos' : `Agregar ${asset.filename}`}
    className={`group overflow-hidden rounded-2xl border text-left shadow-sm transition ${selected || disabled ? 'border-wa-primary bg-green-50/80 dark:bg-green-950/20' : 'border-wa-border bg-white/90 hover:-translate-y-0.5 hover:border-wa-primary hover:shadow-md dark:border-wa-border-dark dark:bg-wa-head-dark/90'} disabled:cursor-default disabled:hover:translate-y-0`}
  >
    <span className="relative block h-36 overflow-hidden bg-wa-hover dark:bg-wa-head-dark">
      {(isImage || isVideo) && !previewFailed ? (
        isImage
          ? <img src={url} alt="" loading="lazy" onError={() => setPreviewFailed(true)} className="h-full w-full object-cover" />
          : <video src={url} preload="metadata" onError={() => setPreviewFailed(true)} className="h-full w-full bg-black object-contain" />
      ) : (
        <span className="flex h-full flex-col items-center justify-center gap-2 text-wa-muted"><TypeIcon className="h-9 w-9 opacity-70" />{previewFailed && <span className="text-[11px] font-semibold">Vista previa no disponible</span>}</span>
      )}
      <span className="absolute left-2.5 top-2.5 rounded-full bg-black/65 px-2 py-1 text-[10px] font-bold text-white backdrop-blur">{typeLabel}</span>
      {(selected || disabled) && <span className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full bg-wa-primary-strong text-white"><Check className="h-4 w-4" /></span>}
    </span>
    <span className="block p-3">
      <span className="block truncate text-xs font-bold text-wa-text dark:text-white">{asset.filename}</span>
      <span className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-wa-muted"><span>{formatBytes(asset.size_bytes)}</span><span>{selected ? 'Seleccionado' : disabled ? 'Ya agregado' : unavailable ? 'Límite alcanzado' : 'Agregar archivo'}</span></span>
    </span>
  </button>
}

export function MediaLibraryPicker({ selectedIds, disabledIds, canSelect, onSelect, onClose, defaultKind }: Props) {
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<MediaAssetKind | ''>(defaultKind ?? '')
  const deferredSearch = useDeferredValue(search.trim())
  const { data = [], isLoading } = useMediaLibrary(deferredSearch, kind)

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClassElevated} />
        <Dialog.Content className={`${dialogContentPositionClassElevated} flex max-h-[88vh] w-[calc(100%-2rem)] max-w-5xl flex-col overflow-hidden rounded-3xl border border-wa-border bg-[#f7faf9] shadow-2xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}>
        <div className="flex items-center justify-between gap-3 border-b border-wa-border bg-white/80 px-5 py-5 dark:border-wa-border-dark dark:bg-wa-head-dark sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary"><FolderOpen className="h-5 w-5" /></span>
            <div>
              <Dialog.Title className="text-lg font-bold text-wa-text dark:text-white">Elegir de la biblioteca</Dialog.Title>
              <p className="mt-1 text-xs text-wa-muted">Selecciona archivos existentes para adjuntarlos a esta plantilla.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar biblioteca" className="rounded-xl p-2 text-wa-muted hover:bg-wa-field dark:hover:bg-wa-active-dark"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex flex-col gap-3 border-b border-wa-border bg-white/60 p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark/70 sm:px-6 sm:py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1 lg:max-w-md">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted" />
            <input value={search} onChange={event => setSearch(event.target.value)} autoFocus placeholder="Buscar por nombre o tipo" aria-label="Buscar archivos" className="h-11 w-full rounded-xl border border-wa-border bg-[#f7faf9] pl-10 pr-3 text-sm outline-none focus:border-wa-primary dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark" />
          </div>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-wa-field p-1 dark:bg-wa-head-dark" aria-label="Filtrar por tipo">
            {FILTERS.map(filter => <button key={filter.value} type="button" onClick={() => setKind(filter.value)} aria-pressed={kind === filter.value} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-bold transition ${kind === filter.value ? 'bg-wa-primary-strong text-white shadow-sm' : 'text-wa-muted hover:bg-white dark:text-wa-muted-dark dark:hover:bg-wa-active-dark'}`}>{filter.label}</button>)}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
          <div className="mb-4 flex items-end justify-between gap-3"><div><h3 className="text-sm font-bold text-wa-text dark:text-white">Archivos disponibles</h3><p className="mt-1 text-xs text-wa-muted">Haz clic en una tarjeta para agregarla.</p></div><span className="rounded-full border border-wa-border bg-white/75 px-3 py-1.5 text-xs font-semibold text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark">{data.length} {data.length === 1 ? 'resultado' : 'resultados'}</span></div>
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-wa-primary-strong" /></div>
          ) : data.length === 0 ? (
            <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed border-wa-border bg-white/70 px-5 py-12 text-center dark:border-wa-border-dark dark:bg-wa-head-dark/70"><FolderOpen className="h-9 w-9 text-wa-muted" /><p className="text-sm font-bold text-wa-text dark:text-white">No hay archivos que coincidan</p><p className="text-xs text-wa-muted">Prueba otra búsqueda o cambia el tipo de archivo.</p></div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 190px), 1fr))' }}>
              {data.map(asset => <AssetTile key={asset.id} asset={asset} selected={selectedIds.has(asset.id)} disabled={disabledIds.has(asset.id)} canSelect={canSelect} onSelect={onSelect} />)}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-wa-border bg-white/80 px-5 py-3 dark:border-wa-border-dark dark:bg-wa-head-dark sm:px-6"><p className="text-xs text-wa-muted">{!canSelect ? 'Alcanzaste el límite de adjuntos de esta plantilla.' : 'Los archivos seleccionados se agregarán a la plantilla al guardar.'}</p><button type="button" onClick={onClose} className="rounded-xl bg-wa-primary-strong px-4 py-2 text-xs font-bold text-white hover:bg-wa-primary">Listo</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
