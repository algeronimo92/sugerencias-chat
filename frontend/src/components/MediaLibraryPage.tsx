import { useDeferredValue, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ExternalLink, Eye, File as FileIcon, FileText, Film, FolderOpen, Images, Loader2, Pencil, Search, Trash2, UploadCloud, X } from 'lucide-react'
import type { MediaAsset, MediaAssetKind } from '../types'
import { useDeleteMediaAsset, useMediaLibrary, useRenameMediaAsset, useUploadMediaAsset } from '../hooks/useMediaLibrary'
import { extractErrorMessage } from '../utils/errors'
import { resolveMediaUrl } from '../utils/message'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'
import { AudioPlayer, VideoPlayer } from './MediaPlayer'

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

function splitFilename(filename: string) {
  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === filename.length - 1) {
    return { basename: filename, extension: '' }
  }
  return {
    basename: filename.slice(0, dotIndex),
    extension: filename.slice(dotIndex),
  }
}

function AssetPreview({ asset, onPreview }: { asset: MediaAsset; onPreview: () => void }) {
  const url = resolveMediaUrl(asset.media_url) ?? ''
  const [imageFailed, setImageFailed] = useState(false)
  if (asset.content_type.startsWith('image/')) {
    if (imageFailed) {
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
        <img src={url} alt={asset.filename} loading="lazy" onError={() => setImageFailed(true)} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100 group-focus-visible:bg-black/30 group-focus-visible:opacity-100">
          <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold"><Eye className="h-4 w-4" />Vista previa</span>
        </span>
      </button>
    )
  }
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
  return (
    <div className="flex h-44 items-center justify-center bg-wa-hover dark:bg-wa-panel-dark">
      <FileText className="h-12 w-12 text-wa-muted" />
    </div>
  )
}

export function MediaLibraryPage() {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  const [kind, setKind] = useState<MediaAssetKind | ''>('')
  const { data = [], isLoading } = useMediaLibrary(deferredSearch, kind)
  const upload = useUploadMediaAsset()
  const rename = useRenameMediaAsset()
  const remove = useDeleteMediaAsset()
  const [error, setError] = useState<string | null>(null)
  const [uploadingName, setUploadingName] = useState<string | null>(null)
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null)
  const [renameAsset, setRenameAsset] = useState<MediaAsset | null>(null)
  const [renameBasename, setRenameBasename] = useState('')
  const [renameExtension, setRenameExtension] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragDepth = useRef(0)
  const imageCount = data.filter(asset => asset.content_type.startsWith('image/')).length
  const mediaCount = data.filter(asset => asset.content_type.startsWith('video/') || asset.content_type.startsWith('audio/')).length
  const documentCount = data.filter(asset => !asset.content_type.startsWith('image/') && !asset.content_type.startsWith('video/') && !asset.content_type.startsWith('audio/')).length

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
      if (files.length) toast.success(files.length === 1 ? 'Archivo subido' : `${files.length} archivos subidos`)
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
    setError(null)
    remove.mutate(asset.id, { onSuccess: () => toast.success('Archivo eliminado'), onError: err => setError(extractErrorMessage(err)) })
  }

  function openRename(asset: MediaAsset) {
    const { basename, extension } = splitFilename(asset.filename)
    setRenameAsset(asset)
    setRenameBasename(basename)
    setRenameExtension(extension)
    setRenameError(null)
  }

  function closeRename() {
    if (rename.isPending) return
    setRenameAsset(null)
    setRenameBasename('')
    setRenameExtension('')
    setRenameError(null)
  }

  function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renameAsset) return
    const basename = renameBasename.trim()
    if (!basename || (!renameExtension && basename.includes('.'))) return
    const filename = `${basename}${renameExtension}`
    if (filename === renameAsset.filename) return
    setRenameError(null)
    rename.mutate(
      { id: renameAsset.id, filename },
      {
        onSuccess: () => {
          toast.success('Archivo renombrado')
          setRenameAsset(null)
          setRenameBasename('')
          setRenameExtension('')
        },
        onError: err => setRenameError(extractErrorMessage(err)),
      },
    )
  }

  return (
    <div className="relative h-full overflow-x-hidden overflow-y-auto bg-wa-app dark:bg-wa-app-dark">
      <main className="relative mx-auto max-w-[1240px] px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
        <header style={{ marginBottom: 24 }}>
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-wa-primary-strong dark:text-wa-primary">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-wa-primary/12"><FolderOpen className="h-4 w-4" /></span>
            Contenido del equipo
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-wa-text dark:text-white">Biblioteca de archivos</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">Organiza imágenes, videos, audios y documentos reutilizables en las plantillas del equipo.</p>
        </header>

        {error && <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">{error}</div>}

        <section className="mb-5 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }} aria-label="Resumen de archivos visibles">
          {[
            { label: 'Archivos visibles', value: data.length, icon: FolderOpen, tone: 'text-wa-primary-strong dark:text-wa-primary' },
            { label: 'Imágenes', value: imageCount, icon: Images, tone: 'text-cyan-600 dark:text-cyan-300' },
            { label: 'Audio y video', value: mediaCount, icon: Film, tone: 'text-violet-600 dark:text-violet-300' },
            { label: 'Documentos', value: documentCount, icon: FileText, tone: 'text-amber-600 dark:text-amber-300' },
          ].map(item => {
            const Icon = item.icon
            return <div key={item.label} className="flex items-center justify-between rounded-2xl border border-wa-border bg-white/80 px-4 py-3 shadow-sm dark:border-wa-border-dark dark:bg-wa-panel-dark/80"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-wa-muted">{item.label}</p><p className="mt-1 text-xl font-bold text-wa-text dark:text-white">{item.value}</p></div><span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-wa-field dark:bg-wa-head-dark ${item.tone}`}><Icon className="h-4 w-4" /></span></div>
          })}
        </section>

        <section
          onDragEnter={handleDragEnter}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`mb-5 rounded-2xl border-2 border-dashed p-4 transition sm:p-5 ${isDragging ? 'border-wa-primary bg-green-50 shadow-lg shadow-emerald-950/5 dark:bg-green-950/30' : 'border-wa-border bg-white/75 dark:border-wa-border-dark dark:bg-wa-panel-dark/75'}`}
        >
          <label className="flex cursor-pointer flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <span className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary">{uploadingName ? <Loader2 className="h-6 w-6 animate-spin" /> : <UploadCloud className="h-6 w-6" />}</span>
              <span><span className="block text-sm font-bold text-wa-text dark:text-white">{uploadingName ? `Subiendo ${uploadingName}` : isDragging ? 'Suelta los archivos aquí' : 'Carga archivos a la biblioteca'}</span><span className="mt-1 block text-xs text-wa-muted">Arrastra varios archivos o selecciónalos · máximo 25 MB cada uno</span></span>
            </span>
            <span className="rounded-xl bg-wa-primary-strong px-4 py-2.5 text-xs font-bold text-white shadow-sm">Seleccionar archivos</span>
            <input type="file" multiple disabled={!!uploadingName} accept={ACCEPTED_TYPES} className="hidden" onChange={event => { void uploadFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
          </label>
        </section>

        <section className="mb-5 rounded-2xl border border-wa-border bg-white/80 p-3 shadow-sm dark:border-wa-border-dark dark:bg-wa-panel-dark/80">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative min-w-0 flex-1 sm:max-w-md">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nombre o tipo" className="h-11 w-full rounded-xl border border-wa-border bg-[#f7faf9] pl-10 pr-3 text-sm outline-none focus:border-wa-primary dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark" />
            </div>
            <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-wa-field p-1 dark:bg-wa-head-dark">
              {FILTERS.map(filter => <button key={filter.value} type="button" onClick={() => setKind(filter.value)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-bold transition ${kind === filter.value ? 'bg-wa-primary-strong text-white shadow-sm' : 'text-wa-muted hover:bg-white dark:text-wa-muted-dark dark:hover:bg-wa-active-dark'}`}>{filter.label}</button>)}
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-3 px-1"><div><h2 className="text-base font-bold text-wa-text dark:text-white">Archivos</h2><p className="mt-0.5 text-xs text-wa-muted">Contenido disponible según tu búsqueda y filtros.</p></div><span className="rounded-full border border-wa-border bg-white/75 px-3 py-1.5 text-xs font-semibold text-wa-muted dark:border-wa-border-dark dark:bg-wa-panel-dark/75">{data.length} {data.length === 1 ? 'resultado' : 'resultados'}</span></div>
          {isLoading ? <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-wa-primary-strong" /></div> : data.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-wa-border bg-white/70 px-6 py-14 text-center dark:border-wa-border-dark dark:bg-wa-panel-dark/60"><FileIcon className="mx-auto h-10 w-10 text-wa-muted" /><h3 className="mt-4 text-sm font-bold text-wa-text dark:text-white">No hay archivos que coincidan</h3><p className="mt-1 text-xs text-wa-muted">Prueba otra búsqueda, cambia el tipo o sube un archivo nuevo.</p></div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
              {data.map(asset => {
                const url = resolveMediaUrl(asset.media_url) ?? '#'
                const typeLabel = asset.content_type.startsWith('image/') ? 'Imagen' : asset.content_type.startsWith('video/') ? 'Video' : asset.content_type.startsWith('audio/') ? 'Audio' : 'Documento'
                return <article key={asset.id} className="group overflow-hidden rounded-2xl border border-wa-border bg-white/90 shadow-sm transition hover:-translate-y-0.5 hover:border-wa-primary/35 hover:shadow-md dark:border-wa-border-dark dark:bg-wa-head-dark/90">
                  <div className="relative"><AssetPreview asset={asset} onPreview={() => setPreviewAsset(asset)} /><span className="absolute left-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur">{typeLabel}</span></div>
                  <div className="p-4">
                    <a href={url} target="_blank" rel="noreferrer" title={asset.filename} className="block truncate text-sm font-bold text-wa-text hover:text-wa-primary-strong dark:text-white">{asset.filename}</a>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-wa-muted"><span>{formatBytes(asset.size_bytes)}</span><span className={`rounded-full px-2 py-0.5 ${asset.use_count ? 'bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary' : 'bg-wa-field dark:bg-wa-panel-dark'}`}>{asset.use_count ? `Usado ${asset.use_count}x` : 'Sin usar'}</span></div>
                    <div className="mt-4 flex items-center justify-between border-t border-wa-border pt-3 dark:border-wa-border-dark">
                      <span className="min-w-0 truncate text-[11px] text-wa-muted">{asset.uploaded_by_name ?? 'Archivo migrado'}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button type="button" disabled={rename.isPending || remove.isPending} onClick={() => openRename(asset)} title="Cambiar nombre" className="rounded-lg p-2 text-wa-muted hover:bg-wa-field hover:text-wa-primary-strong disabled:opacity-40 dark:hover:bg-wa-active-dark"><Pencil className="h-4 w-4" /></button>
                        <ConfirmDialog title={asset.use_count ? 'Archivo en uso' : 'Eliminar archivo'} description={asset.use_count ? `${asset.filename} está asociado a ${asset.use_count} plantilla(s). Quita primero esos adjuntos para evitar romper las plantillas.` : `¿Quieres eliminar ${asset.filename} de la biblioteca? Esta acción no se puede deshacer.`} confirmLabel={asset.use_count ? 'Entendido' : 'Eliminar archivo'} confirmVariant={asset.use_count ? 'secondary' : 'danger'} cancelLabel={asset.use_count ? 'Cerrar' : 'Cancelar'} disabled={remove.isPending} onConfirm={() => { if (!asset.use_count) deleteAsset(asset) }}>
                          <button type="button" disabled={remove.isPending} title={asset.use_count ? `Usado en ${asset.use_count} plantilla(s)` : 'Eliminar archivo'} className="rounded-lg p-2 text-wa-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/30"><Trash2 className="h-4 w-4" /></button>
                        </ConfirmDialog>
                      </div>
                    </div>
                  </div>
                </article>
              })}
            </div>
          )}
        </section>
      </main>
      <Dialog.Root open={renameAsset != null} onOpenChange={open => { if (!open) closeRename() }}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialogOverlayClass} />
          <Dialog.Content asChild className={`${dialogContentPositionClass} w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-2xl border border-wa-border bg-white shadow-2xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}>
            <form onSubmit={submitRename}>
              <div className="flex items-center justify-between border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
                <Dialog.Title className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Cambiar nombre</Dialog.Title>
                <Dialog.Close asChild><button type="button" disabled={rename.isPending} title="Cerrar" className="rounded-lg p-2 text-wa-muted hover:bg-wa-field disabled:opacity-40 dark:hover:bg-wa-head-dark"><X className="h-4 w-4" /></button></Dialog.Close>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                  <label className="grid gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                    Nombre
                    <input
                      autoFocus
                      required
                      maxLength={Math.max(1, 255 - renameExtension.length)}
                      value={renameBasename}
                      onChange={event => setRenameBasename(event.target.value)}
                      className="min-w-0 rounded-lg border border-wa-border bg-white px-3 py-2 text-sm font-normal text-wa-text outline-none focus:border-wa-primary dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark"
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                    Extensión
                    <input
                      readOnly
                      aria-readonly="true"
                      value={renameExtension || 'Sin extensión'}
                      title="La extensión está bloqueada para conservar el tipo real del archivo"
                      className="cursor-not-allowed rounded-lg border border-wa-border bg-wa-field px-3 py-2 text-sm font-medium text-wa-muted outline-none dark:border-wa-border-dark dark:bg-wa-app-dark dark:text-wa-muted-dark"
                    />
                  </label>
                </div>
                <p className="mt-1.5 text-[11px] text-wa-muted">La extensión está bloqueada. El objeto de MinIO y su URL no cambiarán.</p>
                {renameError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{renameError}</p>}
              </div>
              <div className="flex justify-end gap-2 border-t border-wa-border px-4 py-3 dark:border-wa-border-dark">
                <button type="button" disabled={rename.isPending} onClick={closeRename} className="rounded-lg px-3 py-2 text-xs font-semibold text-wa-muted hover:bg-wa-field disabled:opacity-40 dark:hover:bg-wa-head-dark">Cancelar</button>
                <button type="submit" disabled={rename.isPending || !renameBasename.trim() || (!renameExtension && renameBasename.includes('.')) || `${renameBasename.trim()}${renameExtension}` === renameAsset?.filename} className="flex items-center gap-1.5 rounded-lg bg-wa-primary px-3 py-2 text-xs font-semibold text-white hover:bg-wa-primary-strong disabled:opacity-40">
                  {rename.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {rename.isPending ? 'Guardando…' : 'Guardar nombre'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={previewAsset != null} onOpenChange={open => { if (!open) setPreviewAsset(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className={`${dialogOverlayClass} bg-black/75`} />
          <Dialog.Content className={`${dialogContentPositionClass} flex max-h-[92vh] w-[calc(100%-2rem)] max-w-6xl flex-col overflow-hidden rounded-2xl border border-wa-border bg-white shadow-2xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}>
            <div className="flex items-center justify-between gap-3 border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
              <Dialog.Title className="min-w-0 truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">
                {previewAsset?.filename ?? 'Vista previa'}
              </Dialog.Title>
              <div className="flex shrink-0 items-center gap-1">
                {previewAsset && <a href={resolveMediaUrl(previewAsset.media_url) ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-wa-primary-strong hover:bg-green-50 dark:text-wa-primary dark:hover:bg-green-950/40"><ExternalLink className="h-3.5 w-3.5" />Abrir original</a>}
                <Dialog.Close asChild><button type="button" title="Cerrar vista previa" className="rounded-lg p-2 text-wa-muted hover:bg-wa-field dark:hover:bg-wa-head-dark"><X className="h-4 w-4" /></button></Dialog.Close>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-wa-app p-3 dark:bg-wa-app-dark sm:p-5">
              {previewAsset && <img src={resolveMediaUrl(previewAsset.media_url) ?? ''} alt={previewAsset.filename} className="max-h-[calc(92vh-5rem)] max-w-full rounded-lg object-contain shadow-lg" />}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
