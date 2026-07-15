import { useDeferredValue, useState } from 'react'
import { Check, FileText, Image, Loader2, Search, X } from 'lucide-react'
import type { MediaAsset, MediaAssetKind } from '../types'
import { useMediaLibrary } from '../hooks/useMediaLibrary'
import { resolveMediaUrl } from '../utils/message'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label="Seleccionar archivos de la biblioteca" className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Image className="h-5 w-5 text-green-600" />
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">Biblioteca de archivos</h2>
              <p className="text-xs text-gray-400">Selecciona archivos para esta plantilla</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-gray-800 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} autoFocus placeholder="Buscar archivo" className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map(filter => <button key={filter.value} type="button" onClick={() => setKind(filter.value)} className={`rounded-md px-2.5 py-1.5 text-xs ${kind === filter.value ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>{filter.label}</button>)}
          </div>
        </div>

        <div className="overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : data.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-400">No hay archivos disponibles</p>
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
                    className={`overflow-hidden rounded-lg border text-left transition-colors ${selected || disabled ? 'border-green-400 bg-green-50 dark:bg-green-950/20' : 'border-gray-200 hover:border-green-400 dark:border-gray-700'} disabled:cursor-default`}
                  >
                    {asset.content_type.startsWith('image/') ? (
                      <img src={url} alt={asset.filename} loading="lazy" className="h-24 w-full object-cover" />
                    ) : asset.content_type.startsWith('video/') ? (
                      <video src={url} preload="metadata" className="h-24 w-full bg-black object-contain" />
                    ) : (
                      <div className="flex h-24 items-center justify-center bg-gray-50 dark:bg-gray-800"><FileText className="h-8 w-8 text-gray-400" /></div>
                    )}
                    <div className="flex items-center gap-1.5 p-2">
                      {(selected || disabled) && <Check className="h-3.5 w-3.5 shrink-0 text-green-600" />}
                      <span className="truncate text-xs text-gray-700 dark:text-gray-200">{asset.filename}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
