import { useRef, useState } from 'react'
import { FileText, FolderOpen, ImagePlus, Loader2, Pencil, Plus, Power, Star, Trash2, UploadCloud } from 'lucide-react'
import type { LeadStage, MediaAsset, MessageTemplate, TaskType } from '../types'
import { LEAD_STAGES } from '../types'
import { useAddLibraryTemplateAttachment, useCreateTemplate, useDeleteTemplateAttachment, useTemplates, useUpdateTemplate, useUploadTemplateAttachment } from '../hooks/useTemplates'
import { extractErrorMessage } from '../utils/errors'
import { MediaLibraryPicker } from './MediaLibraryPicker'

const TASK_TYPES: { value: TaskType; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'llamada', label: 'Llamada' },
  { value: 'cotizacion', label: 'Cotización' },
  { value: 'cita', label: 'Cita' },
  { value: 'seguimiento', label: 'Seguimiento' },
  { value: 'otro', label: 'Otro' },
]

const EMPTY_FORM = {
  name: '',
  shortcut: '',
  content: '',
  category: 'seguimiento',
  stage: '' as LeadStage | '',
  taskType: '' as TaskType | '',
}

const ACCEPTED_ATTACHMENT_TYPES = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip'

type PendingAttachment =
  | { key: string; source: 'upload'; file: File }
  | { key: string; source: 'library'; asset: MediaAsset }

function pendingKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function TemplatesPage() {
  const { data = [], isLoading } = useTemplates(true)
  const { mutate: create, isPending: isCreating } = useCreateTemplate()
  const { mutate: update, isPending: isUpdating } = useUpdateTemplate()
  const uploadAttachment = useUploadTemplateAttachment()
  const addLibraryAttachment = useAddLibraryTemplateAttachment()
  const deleteAttachment = useDeleteTemplateAttachment()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const dragDepth = useRef(0)

  function openCreateForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError(null)
    setPendingAttachments([])
    setOpen(true)
  }

  function openEditForm(template: MessageTemplate) {
    setEditingId(template.id)
    setForm({
      name: template.name,
      shortcut: template.shortcut ?? '',
      content: template.content,
      category: template.category,
      stage: template.stage ?? '',
      taskType: template.task_type ?? '',
    })
    setError(null)
    setPendingAttachments([])
    setOpen(true)
  }

  function closeForm() {
    setOpen(false)
    setEditingId(null)
    setPendingAttachments([])
    setLibraryOpen(false)
    setIsDraggingFiles(false)
    dragDepth.current = 0
  }

  async function attachPending(templateId: number) {
    for (const attachment of [...pendingAttachments]) {
      if (attachment.source === 'upload') {
        await uploadAttachment.mutateAsync({
          templateId,
          contentType: attachment.file.type,
          dataBase64: await fileToBase64(attachment.file),
          filename: attachment.file.name,
        })
      } else {
        await addLibraryAttachment.mutateAsync({ templateId, assetId: attachment.asset.id })
      }
      setPendingAttachments(items => items.filter(item => item.key !== attachment.key))
    }
  }

  function addFiles(files: File[]) {
    const existingCount = editingTemplate?.attachments.length ?? 0
    const available = Math.max(0, 10 - existingCount - pendingAttachments.length)
    if (files.length > available) setError(`Solo puedes agregar ${available} archivo${available === 1 ? '' : 's'} más`)
    setPendingAttachments(current => [
      ...current,
      ...files.slice(0, available).map(file => ({
        key: pendingKey('upload'),
        source: 'upload' as const,
        file,
      })),
    ])
  }

  function addFromLibrary(asset: MediaAsset) {
    const existingCount = editingTemplate?.attachments.length ?? 0
    if (existingCount + pendingAttachments.length >= 10) {
      setError('Una plantilla admite como máximo 10 adjuntos')
      return
    }
    setPendingAttachments(current => [
      ...current,
      { key: `library-${asset.id}`, source: 'library', asset },
    ])
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current += 1
    if (event.dataTransfer.types.includes('Files')) setIsDraggingFiles(true)
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDraggingFiles(false)
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = 0
    setIsDraggingFiles(false)
    addFiles(Array.from(event.dataTransfer.files))
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const payload = {
      name: form.name,
      shortcut: form.shortcut || null,
      content: form.content,
      category: form.category,
      stage: form.stage || null,
      task_type: form.taskType || null,
    }
    if (editingId != null) {
      update({ id: editingId, ...payload }, {
        onSuccess: async (template) => { try { await attachPending(template.id); closeForm() } catch (err) { setError(extractErrorMessage(err)) } },
        onError: (err) => setError(extractErrorMessage(err)),
      })
    } else {
      create(
        { ...payload, service: null },
        { onSuccess: async (template) => { try { await attachPending(template.id); closeForm() } catch (err) { setError(extractErrorMessage(err)) } }, onError: (err) => setError(extractErrorMessage(err)) }
      )
    }
  }

  function handleToggleActive(id: number, isActive: boolean) {
    setError(null)
    update({ id, is_active: isActive }, { onError: (err) => setError(extractErrorMessage(err)) })
  }

  const isSaving = (editingId != null ? isUpdating : isCreating) || uploadAttachment.isPending || addLibraryAttachment.isPending
  const editingTemplate = data.find(template => template.id === editingId)
  const selectedLibraryIds = new Set(
    pendingAttachments.flatMap(item => item.source === 'library' ? [item.asset.id] : [])
  )
  const existingLibraryIds = new Set(
    (editingTemplate?.attachments ?? []).flatMap(item => item.library_asset_id == null ? [] : [item.library_asset_id])
  )
  const canAddAttachment = (editingTemplate?.attachments.length ?? 0) + pendingAttachments.length < 10

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6 dark:bg-gray-950">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-green-600" />
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Plantillas</h1>
          </div>
          <button
            type="button"
            onClick={() => (open ? closeForm() : openCreateForm())}
            className="flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            <Plus className="h-4 w-4" /> Nueva plantilla
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </div>
        )}

        {open && (
          <form onSubmit={handleSubmit} className="mb-6 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              {editingId != null ? 'Editar plantilla' : 'Nueva plantilla'}
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                required
                placeholder="Nombre"
                value={form.name}
                onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              />
              <input
                placeholder="Atajo, ej. cotizacion"
                value={form.shortcut}
                onChange={(event) => setForm((f) => ({ ...f, shortcut: event.target.value }))}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              />
            </div>
            <textarea
              required
              rows={4}
              placeholder="Hola {{nombre}}, ..."
              value={form.content}
              onChange={(event) => setForm((f) => ({ ...f, content: event.target.value }))}
              className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <input
                placeholder="Categoría"
                value={form.category}
                onChange={(event) => setForm((f) => ({ ...f, category: event.target.value }))}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              />
              <select
                value={form.stage}
                onChange={(event) => setForm((f) => ({ ...f, stage: event.target.value as LeadStage | '' }))}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                <option value="">Cualquier etapa</option>
                {LEAD_STAGES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select
                value={form.taskType}
                onChange={(event) => setForm((f) => ({ ...f, taskType: event.target.value as TaskType | '' }))}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                <option value="">Cualquier tarea</option>
                {TASK_TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Variables: {'{{nombre}}'}, {'{{telefono}}'}, {'{{servicio}}'}, {'{{vendedor}}'}, {'{{fecha_actual}}'}
            </p>
            <div
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`rounded-lg border-2 border-dashed p-4 transition-colors ${
                isDraggingFiles
                  ? 'border-green-500 bg-green-50 dark:border-green-400 dark:bg-green-950/30'
                  : 'border-gray-300 dark:border-gray-600'
              }`}
            >
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 py-2 text-center text-sm font-medium text-gray-500 hover:text-green-600">
                {isDraggingFiles ? <UploadCloud className="h-7 w-7 text-green-600" /> : <ImagePlus className="h-6 w-6" />}
                <span>{isDraggingFiles ? 'Suelta los archivos aquí' : 'Arrastra archivos aquí o haz clic para seleccionarlos'}</span>
                <span className="text-xs font-normal text-gray-400">Imágenes, videos, audios o documentos</span>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  accept={ACCEPTED_ATTACHMENT_TYPES}
                  onChange={(event) => {
                    addFiles(Array.from(event.target.files ?? []))
                    event.target.value = ''
                  }}
                />
              </label>
              <div className="mt-2 flex justify-center">
                <button type="button" onClick={() => setLibraryOpen(true)} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-violet-600 hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-violet-950/30">
                  <FolderOpen className="h-4 w-4" /> Elegir de la biblioteca
                </button>
              </div>
              {((editingTemplate?.attachments.length ?? 0) > 0 || pendingAttachments.length > 0) && (
                <div className="mt-3 space-y-1">
                  {editingTemplate?.attachments.map(attachment => (
                    <div key={attachment.id} className="flex items-center justify-between rounded bg-gray-50 px-2 py-1.5 text-xs dark:bg-gray-900">
                      <span className="truncate">{attachment.filename}</span>
                      <button type="button" onClick={() => deleteAttachment.mutate(attachment.id)} title="Quitar adjunto"><Trash2 className="h-3.5 w-3.5 text-red-400" /></button>
                    </div>
                  ))}
                  {pendingAttachments.map(attachment => {
                    const filename = attachment.source === 'upload' ? attachment.file.name : attachment.asset.filename
                    return (
                      <div key={attachment.key} className="flex items-center justify-between rounded bg-green-50 px-2 py-1.5 text-xs text-green-700 dark:bg-green-950/30 dark:text-green-400">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {attachment.source === 'library' && <FolderOpen className="h-3.5 w-3.5 shrink-0" />}
                          <span className="truncate">{filename}</span>
                        </span>
                        <button type="button" onClick={() => setPendingAttachments(items => items.filter(item => item.key !== attachment.key))}><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    )
                  })}
                </div>
              )}
              <p className="mt-2 text-[11px] text-gray-400">Máximo 25 MB por archivo. Se enviarán en el orden agregado.</p>
            </div>
            {libraryOpen && (
              <MediaLibraryPicker
                selectedIds={selectedLibraryIds}
                disabledIds={existingLibraryIds}
                canSelect={canAddAttachment}
                onSelect={addFromLibrary}
                onClose={() => setLibraryOpen(false)}
              />
            )}
            <div className="flex gap-2">
              <button
                disabled={isSaving}
                className="flex items-center justify-center gap-1.5 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId != null ? 'Guardar cambios' : 'Guardar plantilla'}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.map((template) => (
              <article
                key={template.id}
                className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 ${!template.is_active ? 'opacity-60' : ''}`}
              >
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h2 className="truncate font-medium text-gray-900 dark:text-white">{template.name}</h2>
                      {template.is_favorite && <Star className="h-3.5 w-3.5 shrink-0 fill-yellow-400 text-yellow-400" />}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {template.category}
                      {template.shortcut ? ` · /${template.shortcut}` : ''}
                      {template.visibility === 'personal' ? ' · Personal' : ' · Equipo'}
                      {template.use_count > 0 ? ` · Usada ${template.use_count}x` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title="Editar"
                      onClick={() => openEditForm(template)}
                      className="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <Pencil className="h-4 w-4 text-gray-400 hover:text-green-600" />
                    </button>
                    <button
                      type="button"
                      title={template.is_active ? 'Desactivar' : 'Activar'}
                      onClick={() => handleToggleActive(template.id, !template.is_active)}
                      className="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <Power className={`h-4 w-4 ${template.is_active ? 'text-green-600' : 'text-gray-400'}`} />
                    </button>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">{template.content}</p>
                {template.attachments.length>0&&<div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400"><ImagePlus className="h-3.5 w-3.5"/>{template.attachments.length} adjunto{template.attachments.length===1?'':'s'}</div>}
              </article>
            ))}
            {data.length === 0 && (
              <p className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-sm text-gray-400 dark:border-gray-700 md:col-span-2">
                Sin plantillas
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
