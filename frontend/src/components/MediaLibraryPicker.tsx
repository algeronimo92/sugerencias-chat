import { useDeferredValue, useState } from 'react'
import { Check, FileText, Image, Loader2, Search, X } from 'lucide-react'
import type { MediaAsset, MediaAssetKind } from '../types'
import { useMediaLibrary } from '../hooks/useMediaLibrary'
import { resolveMediaUrl } from '../utils/message'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui'

interface Props {
  selectedIds: Set<number>
  disabledIds: Set<number>
  canSelect: boolean
  onSelect: (asset: MediaAsset) => void
  onClose: () => void
}

const FILTERS: { value: MediaAssetKind | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'image', label: 'Imágenes' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audios' },
  { value: 'document', label: 'Documentos' },
]

export function MediaLibraryPicker({ selectedIds, disabledIds, canSelect, onSelect, onClose }: Props) {
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<MediaAssetKind | ''>('')
  const deferredSearch = useDeferredValue(search.trim())
  const { data = [], isLoading } = useMediaLibrary(deferredSearch, kind)

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content className={`${dialogContentPositionClass} flex max-h-[85vh] w-[calc(100%-2rem)] max-w-4xl flex-col rounded-xl bg-white shadow-2xl dark:bg-wa-panel-dark`}>
        <div className="flex items-center justify-between border-b border-wa-border px-5 py-4 dark:border-wa-border-dark">
          <div className="flex items-center gap-2">
            <Image className="h-5 w-5 text-wa-primary-strong" />
            <div>
              <Dialog.Title className="font-semibold text-wa-text dark:text-white">Biblioteca de archivos</Dialog.Title>
              <p className="text-xs text-wa-muted">Selecciona archivos para esta plantilla</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-wa-muted hover:bg-wa-field dark:hover:bg-wa-head-dark"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex flex-col gap-3 border-b border-wa-border p-4 dark:border-wa-border-dark sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-wa-muted" />
            <input value={search} onChange={event => setSearch(event.target.value)} autoFocus placeholder="Buscar archivo" className="w-full rounded-lg border border-wa-border bg-white py-2 pl-9 pr-3 text-sm dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark" />
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map(filter => <button key={filter.value} type="button" onClick={() => setKind(filter.value)} className={`rounded-md px-2.5 py-1.5 text-xs ${kind === filter.value ? 'bg-wa-primary text-white' : 'bg-wa-field text-wa-muted dark:bg-wa-head-dark dark:text-wa-muted-dark'}`}>{filter.label}</button>)}
          </div>
        </div>

        <div className="overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-wa-muted" /></div>
          ) : data.length === 0 ? (
            <p className="py-16 text-center text-sm text-wa-muted">No hay archivos disponibles</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {data.map(asset => {
                const selected = selectedIds.has(asset.id)
                const disabled = disabledIds.has(asset.id)
                const url = resolveMediaUrl(asset.media_url) ?? ''
                return (
                  <button
                    key={asset.id}
                    type="button"
                    disabled={selected || disabled || !canSelect}
                    onClick={() => onSelect(asset)}
                    className={`overflow-hidden rounded-lg border text-left transition-colors ${selected || disabled ? 'border-wa-primary bg-green-50 dark:bg-green-950/20' : 'border-wa-border hover:border-wa-primary dark:border-wa-border-dark'} disabled:cursor-default`}
                  >
                    {asset.content_type.startsWith('image/') ? (
                      <img src={url} alt={asset.filename} loading="lazy" className="h-24 w-full object-cover" />
                    ) : asset.content_type.startsWith('video/') ? (
                      <video src={url} preload="metadata" className="h-24 w-full bg-black object-contain" />
                    ) : (
                      <div className="flex h-24 items-center justify-center bg-wa-hover dark:bg-wa-head-dark"><FileText className="h-8 w-8 text-wa-muted" /></div>
                    )}
                    <div className="flex items-center gap-1.5 p-2">
                      {(selected || disabled) && <Check className="h-3.5 w-3.5 shrink-0 text-wa-primary-strong" />}
                      <span className="truncate text-xs text-gray-700 dark:text-wa-text-dark">{asset.filename}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
