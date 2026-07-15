import { useDeferredValue, useRef, useState } from 'react'
import { File as FileIcon, FileAudio, FileText, Image, Loader2, Search, Trash2, UploadCloud } from 'lucide-react'
import type { MediaAsset, MediaAssetKind } from '../types'
import { useDeleteMediaAsset, useMediaLibrary, useUploadMediaAsset } from '../hooks/useMediaLibrary'
import { extractErrorMessage } from '../utils/errors'
import { resolveMediaUrl } from '../utils/message'

const ACCEPTED_TYPES = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip'
const MAX_BYTES = 25 * 1024 * 1024

const FILTERS: { value: MediaAssetKind | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'image', label: 'Imágenes' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audios' },
  { value: 'document', label: 'Documentos' },
]

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function formatBytes(value: number) {
  if (!value) return 'Tamaño no disponible'
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function AssetPreview({ asset }: { asset: MediaAsset }) {
  const url = resolveMediaUrl(asset.media_url) ?? ''
  if (asset.content_type.startsWith('image/')) {
    return <img src={url} alt={asset.filename} loading="lazy" className="h-36 w-full object-cover" />
  }
  if (asset.content_type.startsWith('video/')) {
    return <video src={url} preload="metadata" controls className="h-36 w-full bg-black object-contain" />
  }
  if (asset.content_type.startsWith('audio/')) {
    return (
      <div className="flex h-36 flex-col items-center justify-center gap-3 bg-violet-50 px-3 dark:bg-violet-950/20">
        <FileAudio className="h-10 w-10 text-violet-500" />
        <audio src={url} controls preload="metadata" className="h-8 w-full" />
      </div>
    )
  }
  return (
    <div className="flex h-36 items-center justify-center bg-gray-50 dark:bg-gray-900">
      <FileText className="h-12 w-12 text-gray-400" />
    </div>
  )
}

export function MediaLibraryPage() {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  const [kind, setKind] = useState<MediaAssetKind | ''>('')
  const { data = [], isLoading } = useMediaLibrary(deferredSearch, kind)
  const upload = useUploadMediaAsset()
  const remove = useDeleteMediaAsset()
  const [error, setError] = useState<string | null>(null)
  const [uploadingName, setUploadingName] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragDepth = useRef(0)

  async function uploadFiles(files: File[]) {
    setError(null)
    const oversized = files.find(file => file.size > MAX_BYTES)
    if (oversized) {
      setError(`${oversized.name} supera el máximo de 25 MB`)
      return
    }
    try {
      for (const file of files) {
        setUploadingName(file.name)
        await upload.mutateAsync({
          contentType: file.type || 'application/octet-stream',
          dataBase64: await fileToBase64(file),
          filename: file.name,
        })
      }
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setUploadingName(null)
    }
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    dragDepth.current += 1
    if (event.dataTransfer.types.includes('Files')) setIsDragging(true)
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragging(false)
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    void uploadFiles(Array.from(event.dataTransfer.files))
  }

  function deleteAsset(asset: MediaAsset) {
    if (!window.confirm(`¿Eliminar ${asset.filename} de la biblioteca?`)) return
    setError(null)
    remove.mutate(asset.id, { onError: err => setError(extractErrorMessage(err)) })
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6 dark:bg-gray-950">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex items-center gap-2">
          <Image className="h-5 w-5 text-green-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Biblioteca de archivos</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Archivos reutilizables para las plantillas del equipo</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </div>
        )}

        <div
          onDragEnter={handleDragEnter}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`mb-5 rounded-xl border-2 border-dashed p-5 transition-colors ${
            isDragging ? 'border-green-500 bg-green-50 dark:bg-green-950/30' : 'border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900'
          }`}
        >
          <label className="flex cursor-pointer flex-col items-center gap-1.5 text-center text-sm font-medium text-gray-600 hover:text-green-600 dark:text-gray-300">
            {uploadingName ? <Loader2 className="h-7 w-7 animate-spin text-green-600" /> : <UploadCloud className="h-7 w-7" />}
            <span>{uploadingName ? `Subiendo ${uploadingName}` : isDragging ? 'Suelta los archivos aquí' : 'Arrastra archivos o haz clic para subir'}</span>
            <span className="text-xs font-normal text-gray-400">Máximo 25 MB por archivo</span>
            <input
              type="file"
              multiple
              disabled={!!uploadingName}
              accept={ACCEPTED_TYPES}
              className="hidden"
              onChange={event => {
                void uploadFiles(Array.from(event.target.files ?? []))
                event.target.value = ''
              }}
            />
          </label>
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar por nombre o tipo"
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(filter => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setKind(filter.value)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${kind === filter.value ? 'bg-green-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800'}`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
        ) : data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center text-sm text-gray-400 dark:border-gray-700">
            <FileIcon className="mx-auto mb-2 h-8 w-8" />
            No hay archivos que coincidan
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.map(asset => {
              const url = resolveMediaUrl(asset.media_url) ?? '#'
              return (
                <article key={asset.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                  <AssetPreview asset={asset} />
                  <div className="p-3">
                    <a href={url} target="_blank" rel="noreferrer" title={asset.filename} className="block truncate text-sm font-medium text-gray-800 hover:text-green-600 dark:text-gray-100">
                      {asset.filename}
                    </a>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-gray-400">
                      <span>{formatBytes(asset.size_bytes)}</span>
                      <span>{asset.use_count ? `Usado ${asset.use_count}x` : 'Sin usar'}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2 dark:border-gray-700">
                      <span className="truncate text-[11px] text-gray-400">{asset.uploaded_by_name ?? 'Archivo migrado'}</span>
                      <button
                        type="button"
                        onClick={() => deleteAsset(asset)}
                        disabled={remove.isPending || asset.use_count > 0}
                        title={asset.use_count ? 'Primero quita el archivo de las plantillas' : 'Eliminar archivo'}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
