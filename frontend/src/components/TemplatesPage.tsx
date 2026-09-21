import { useEffect, useReducer, useRef, useState, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, BadgeCheck, Download, FileText, FolderOpen, ImagePlus, List as ListIcon, Loader2, MessageSquareText, MousePointerClick, Pencil, Plus, Power, RefreshCw, Star, Trash2, UploadCloud } from 'lucide-react'
import type { MediaAsset, MessageTemplate, OfficialTemplateButton } from '../types'
import { LEAD_STAGES, isLeadStage } from '../types'
import { useAddLibraryTemplateAttachment, useCreateTemplate, useDeleteTemplate, useDeleteTemplateAttachment, useSyncTemplate, useTemplateCapabilities, useTemplates, useUpdateTemplate, useUploadTemplateAttachment } from '../hooks/useTemplates'
import { useCreateTemplateCategory, useTemplateCategories } from '../hooks/useTemplateCategories'
import { useMediaLibrary } from '../hooks/useMediaLibrary'
import { extractErrorMessage } from '../utils/errors'
import { ImportMetaTemplatesDialog } from './ImportMetaTemplatesDialog'
import { MediaAssetField } from './MediaAssetField'
import { MediaLibraryPicker } from './MediaLibraryPicker'
import { TASK_TYPE_OPTIONS as TASK_TYPES, isTaskType } from '../domain/automationCatalog'
import { EMPTY_TEMPLATE_FORM as EMPTY_FORM, validateTemplateForm, type TemplateFormState } from '../domain/templateForm'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Select } from './ui/Input'
import './templates-page.css'

// Puras y sin estado: viven en ámbito de módulo para no reconstruirse en
// cada render, lo que además rompía la memoización de los hijos.
function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = 'copy'
}

function officialParameterCount(content: string) {
  return Math.max(0, ...Array.from(content.matchAll(/\{\{(\d+)\}\}/g), match => Number(match[1])))
}

function resizeOfficialParameters(content: string, current: string[]) {
  return Array.from({ length: officialParameterCount(content) }, (_, index) => current[index] ?? '')
}

const ACCEPTED_ATTACHMENT_TYPES = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip'
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg', 'm4a',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip',
])

const REJECTED_REASON_LABELS: Record<string, string> = {
  ABUSIVE_CONTENT: 'Contenido considerado abusivo o engañoso',
  INVALID_FORMAT: 'Formato inválido (variables, saltos de línea o estructura no permitida)',
  TAG_CONTENT_MISMATCH: 'El contenido no coincide con la categoría elegida (Marketing/Utilidad/Autenticación)',
  INCORRECT_CATEGORY: 'Categoría incorrecta para este contenido',
  SCAM: 'Meta lo identificó como posible estafa o phishing',
  NONE: 'Sin motivo informado por Meta',
}

function rejectedReasonLabel(reason: string) {
  return REJECTED_REASON_LABELS[reason] ?? reason
}

function validateAttachmentFile(file: File) {
  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() ?? '' : ''
  if (!file.size) return `${file.name}: el archivo está vacío.`
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name}: supera el máximo de 25 MB.`
  if (file.name.length > 255) return `${file.name}: el nombre admite máximo 255 caracteres.`
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) return `${file.name}: tipo de archivo no permitido.`
  return null
}

type PendingAttachment =
  | { key: string; source: 'upload'; file: File }
  | { key: string; source: 'library'; asset: MediaAsset }

interface TemplatesPageState {
  open: boolean
  editingId: number | null
  form: TemplateFormState
  error: string | null
  pendingAttachments: PendingAttachment[]
  libraryOpen: boolean
  isDraggingFiles: boolean
}

const INITIAL_PAGE_STATE: TemplatesPageState = {
  open: false,
  editingId: null,
  form: EMPTY_FORM,
  error: null,
  pendingAttachments: [],
  libraryOpen: false,
  isDraggingFiles: false,
}

type TemplatesPageUpdate =
  | Partial<TemplatesPageState>
  | ((state: TemplatesPageState) => Partial<TemplatesPageState>)

function templatesPageReducer(state: TemplatesPageState, update: TemplatesPageUpdate): TemplatesPageState {
  return { ...state, ...(typeof update === 'function' ? update(state) : update) }
}

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
  const { data: templateCategories = [], isLoading: categoriesLoading } = useTemplateCategories()
  const createCategory = useCreateTemplateCategory()
  const { data: capabilities } = useTemplateCapabilities()
  const { data: mediaAssets = [] } = useMediaLibrary()
  const { mutate: create, isPending: isCreating } = useCreateTemplate()
  const updateTemplate = useUpdateTemplate()
  const uploadAttachment = useUploadTemplateAttachment()
  const addLibraryAttachment = useAddLibraryTemplateAttachment()
  const deleteTemplate = useDeleteTemplate()
  const deleteAttachment = useDeleteTemplateAttachment()
  const syncTemplate = useSyncTemplate()
  const [pageState, updatePageState] = useReducer(templatesPageReducer, INITIAL_PAGE_STATE)
  const [categoryFormOpen, setCategoryFormOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const { open, editingId, form, error, pendingAttachments, libraryOpen, isDraggingFiles } = pageState
  const setOpen = (value: boolean) => updatePageState({ open: value })
  const setEditingId = (value: number | null) => updatePageState({ editingId: value })
  const setForm = (value: SetStateAction<TemplateFormState>) => updatePageState(state => ({
    form: typeof value === 'function' ? value(state.form) : value,
  }))
  const setError = (value: string | null) => updatePageState({ error: value })
  const setPendingAttachments = (value: SetStateAction<PendingAttachment[]>) => updatePageState(state => ({
    pendingAttachments: typeof value === 'function' ? value(state.pendingAttachments) : value,
  }))
  const setLibraryOpen = (value: boolean) => updatePageState({ libraryOpen: value })
  const setIsDraggingFiles = (value: boolean) => updatePageState({ isDraggingFiles: value })
  const dragDepth = useRef(0)

  useEffect(() => {
    if (!open || editingId != null || form.category || templateCategories.length === 0) return
    updatePageState(state => ({
      form: {
        ...state.form,
        category: templateCategories.find(category => category.name === 'Seguimiento')?.name
          ?? templateCategories[0].name,
      },
    }))
  }, [editingId, form.category, open, templateCategories])

  function openCreateForm() {
    setEditingId(null)
    setForm({
      ...EMPTY_FORM,
      category: templateCategories.find(category => category.name === 'Seguimiento')?.name
        ?? templateCategories[0]?.name
        ?? '',
    })
    setError(null)
    setPendingAttachments([])
    setOpen(true)
    setCategoryFormOpen(false)
    setNewCategoryName('')
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
      templateType: template.template_type,
      officialName: template.official_name ?? '',
      officialLanguage: template.official_language ?? 'es',
      officialCategory: template.official_category ?? 'UTILITY',
      officialParameterValues: template.official_parameter_values,
      officialHeaderType: template.official_header_type,
      officialHeaderText: template.official_header_text ?? '',
      officialHeaderMediaAssetId: template.official_header_media_asset_id,
      officialFooter: template.official_footer ?? '',
      officialButtons: template.official_buttons,
      interactiveType: template.interactive_type,
      interactiveTitle: template.interactive_config.title ?? '',
      interactiveFooter: template.interactive_config.footer?.trim() || template.interactive_config.footerText?.trim() || '',
      interactiveButtonText: template.interactive_config.buttonText ?? 'Ver opciones',
      interactiveButtons: template.interactive_config.buttons ?? [{ type: 'reply', displayText: '', id: 'reply_1' }],
      interactiveSections: template.interactive_config.sections ?? [{ title: 'Opciones', rows: [{ title: '', description: '', rowId: 'option_1' }] }],
    })
    setError(null)
    setPendingAttachments([])
    setOpen(true)
    setCategoryFormOpen(false)
    setNewCategoryName('')
  }

  function closeForm() {
    setOpen(false)
    setEditingId(null)
    setPendingAttachments([])
    setLibraryOpen(false)
    setIsDraggingFiles(false)
    dragDepth.current = 0
    setCategoryFormOpen(false)
    setNewCategoryName('')
  }

  function handleCreateCategory() {
    const name = newCategoryName.trim()
    if (!name || createCategory.isPending) return
    setError(null)
    createCategory.mutate(name, {
      onSuccess: category => {
        setForm(current => ({ ...current, category: category.name }))
        setNewCategoryName('')
        setCategoryFormOpen(false)
        toast.success('Categoría creada y seleccionada')
      },
      onError: reason => setError(extractErrorMessage(reason)),
    })
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
    const fileErrors = files.map(validateAttachmentFile).filter((value): value is string => value != null)
    const validFiles = files.filter(file => validateAttachmentFile(file) == null)
    const existingCount = editingTemplate?.attachments.length ?? 0
    const available = Math.max(0, 10 - existingCount - pendingAttachments.length)
    if (validFiles.length > available) fileErrors.push(`Solo podés agregar ${available} archivo${available === 1 ? '' : 's'} más.`)
    if (fileErrors.length) setError(fileErrors.join('\n'))
    setPendingAttachments(current => [
      ...current,
      ...validFiles.slice(0, available).map(file => ({
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
    const validationErrors = validateTemplateForm(form, capabilities?.interactive_limits)
    if (validationErrors.length) {
      setError(validationErrors.map((message, index) => `${index + 1}. ${message}`).join('\n'))
      return
    }
    const payload = {
      name: form.name,
      shortcut: form.shortcut || null,
      content: form.content,
      category: form.category,
      stage: form.stage || null,
      task_type: form.taskType || null,
      template_type: form.templateType,
      official_name: form.templateType === 'official' ? form.officialName : null,
      official_language: form.templateType === 'official' ? form.officialLanguage : null,
      official_category: form.templateType === 'official' ? form.officialCategory : null,
      official_parameter_values: form.templateType === 'official' ? form.officialParameterValues : [],
      official_header_type: form.templateType === 'official' ? form.officialHeaderType : 'none',
      official_header_text: form.templateType === 'official' && form.officialHeaderType === 'text' ? form.officialHeaderText.trim() : null,
      official_header_media_asset_id: form.templateType === 'official' && form.officialHeaderType === 'image' ? form.officialHeaderMediaAssetId : null,
      official_footer: form.templateType === 'official' ? (form.officialFooter.trim() || null) : null,
      official_buttons: form.templateType === 'official' ? form.officialButtons : [],
      interactive_type: form.templateType === 'internal' ? form.interactiveType : 'none',
      interactive_config: form.templateType !== 'internal' || form.interactiveType === 'none' ? {} : form.interactiveType === 'buttons' ? {
        title: form.interactiveTitle,
        footer: form.interactiveFooter.trim(),
        buttons: form.interactiveButtons,
      } : {
        title: form.interactiveTitle,
        footerText: form.interactiveFooter.trim(),
        buttonText: form.interactiveButtonText,
        sections: form.interactiveSections,
      },
    }
    if (editingId != null) {
      const { template_type: _templateType, ...updatePayload } = payload
      updateTemplate.mutate({ id: editingId, ...updatePayload }, {
        onSuccess: async (template) => { try { if (form.templateType === 'internal' && form.interactiveType === 'none') await attachPending(template.id); closeForm() } catch (err) { setError(extractErrorMessage(err)) } },
        onError: (err) => setError(extractErrorMessage(err)),
      })
    } else {
      create(
        { ...payload, service: null },
        { onSuccess: async (template) => { try { if (form.templateType === 'internal' && form.interactiveType === 'none') await attachPending(template.id); closeForm() } catch (err) { setError(extractErrorMessage(err)) } }, onError: (err) => setError(extractErrorMessage(err)) }
      )
    }
  }

  function handleToggleActive(id: number, isActive: boolean) {
    setError(null)
    updateTemplate.mutate(
      { id, is_active: isActive },
      {
        onSuccess: () => toast.success(isActive ? 'Plantilla activada' : 'Plantilla desactivada'),
        onError: (err) => setError(extractErrorMessage(err)),
      }
    )
  }

  function handleDeleteAttachment(id: number, filename: string) {
    setError(null)
    deleteAttachment.mutate(id, {
      onSuccess: () => toast.success(`${filename} fue quitado de la plantilla`),
      onError: err => setError(extractErrorMessage(err)),
    })
  }

  function handleSyncTemplate(id: number) {
    setError(null)
    syncTemplate.mutate(id, {
      onSuccess: (template) => toast.success(
        template.official_status === 'REJECTED' && template.official_rejected_reason
          ? `Estado actualizado: RECHAZADA — ${rejectedReasonLabel(template.official_rejected_reason)}`
          : `Estado actualizado: ${template.official_status}`,
      ),
      onError: err => setError(extractErrorMessage(err)),
    })
  }

  function handleDeleteTemplate(id: number, name: string) {
    setError(null)
    deleteTemplate.mutate(id, {
      onSuccess: () => toast.success(`${name} fue eliminada`),
      onError: err => setError(extractErrorMessage(err)),
    })
  }

  const isSaving = (editingId != null ? updateTemplate.isPending : isCreating) || uploadAttachment.isPending || addLibraryAttachment.isPending
  const editingTemplate = data.find(template => template.id === editingId)
  const selectedLibraryIds = new Set(
    pendingAttachments.flatMap(item => item.source === 'library' ? [item.asset.id] : [])
  )
  const existingLibraryIds = new Set(
    (editingTemplate?.attachments ?? []).flatMap(item => item.library_asset_id == null ? [] : [item.library_asset_id])
  )
  const canAddAttachment = (editingTemplate?.attachments.length ?? 0) + pendingAttachments.length < 10
  const totalInteractiveRows = form.interactiveSections.reduce((total, section) => total + section.rows.length, 0)
  const maxInteractiveButtons = 3

  return (
    <div className="templates-page h-full overflow-x-hidden overflow-y-auto bg-wa-app dark:bg-wa-app-dark">
      <main className="mx-auto max-w-[1240px] px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
        <header className="templates-hero">
          <div>
            <div className="templates-eyebrow"><span className="templates-eyebrow-icon"><FileText className="h-4 w-4" /></span> Biblioteca de mensajes</div>
            <h1 className="text-3xl font-bold tracking-tight text-wa-text dark:text-white">Plantillas</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">Prepara respuestas consistentes para el equipo y gestiona tus plantillas oficiales de WhatsApp.</p>
          </div>
          <div className="templates-hero-actions">
            <button
              type="button"
              onClick={() => setImportDialogOpen(true)}
              className="flex items-center justify-center gap-2 rounded-xl border border-wa-border bg-white/80 px-4 py-2.5 text-sm font-semibold text-wa-text hover:bg-wa-field dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark dark:hover:bg-wa-head-dark"
            >
              <Download className="h-4 w-4" /> Importar desde Meta
            </button>
            <button
              type="button"
              onClick={() => (open ? closeForm() : openCreateForm())}
              className="flex items-center justify-center gap-2 rounded-xl bg-wa-primary-strong px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-wa-primary"
            >
              <Plus className="h-4 w-4" /> {open ? 'Cerrar formulario' : 'Nueva plantilla'}
            </button>
          </div>
        </header>

        <section className="templates-summary" aria-label="Resumen de plantillas">
          <div className="templates-summary-card"><span>Total</span><strong>{data.length}</strong><FileText className="h-5 w-5 text-wa-primary-strong dark:text-wa-primary" /></div>
          <div className="templates-summary-card"><span>Internas</span><strong>{data.filter(template => template.template_type === 'internal').length}</strong><MessageSquareText className="h-5 w-5 text-cyan-600 dark:text-cyan-300" /></div>
          <div className="templates-summary-card"><span>Oficiales</span><strong>{data.filter(template => template.template_type === 'official').length}</strong><BadgeCheck className="h-5 w-5 text-blue-600 dark:text-blue-300" /></div>
          <div className="templates-summary-card"><span>Activas</span><strong>{data.filter(template => template.is_active).length}</strong><Power className="h-5 w-5 text-amber-600 dark:text-amber-300" /></div>
        </section>

        {importDialogOpen && (
          <ImportMetaTemplatesDialog
            existingMetaIds={new Set(data.flatMap(template => template.meta_template_id ? [template.meta_template_id] : []))}
            categories={templateCategories}
            defaultCategory={templateCategories.find(category => category.name === 'Seguimiento')?.name ?? templateCategories[0]?.name}
            onClose={() => setImportDialogOpen(false)}
          />
        )}

        {capabilities && (
          <div className={`templates-capability mb-4 flex gap-2 rounded-2xl border px-4 py-3 text-xs ${capabilities.official_sending_supported ? 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'}`}>
            {capabilities.official_sending_supported ? <BadgeCheck className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
            <div><p className="font-semibold">Evolution: {capabilities.integration ?? 'integración no detectada'}</p><p className="mt-0.5">{capabilities.official_sending_supported ? 'La conexión admite el envío de plantillas oficiales de Meta.' : capabilities.reason}</p></div>
          </div>
        )}

        {error && (
          <div className="mb-4 whitespace-pre-line rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </div>
        )}

        {open && (
          <form onSubmit={handleSubmit} className="templates-form mb-6 grid gap-5 rounded-3xl border border-wa-border bg-white p-4 text-wa-text shadow-sm dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark sm:p-6">
            <div className="templates-form-heading"><div><span className="templates-form-kicker">Editor de mensajes</span><h2 className="mt-1 text-xl font-bold text-wa-text dark:text-white">{editingId != null ? 'Editar plantilla' : 'Nueva plantilla'}</h2><p className="mt-1 text-sm text-wa-muted">Configura el contenido y dónde estará disponible para el equipo.</p></div><span className="templates-form-step">01 / 03</span></div>
            <div className="templates-section-label"><span>01</span><div><strong>Tipo de plantilla</strong><p>Elige cómo se enviará este mensaje.</p></div></div>
            <div className="grid gap-2 md:grid-cols-2">
              <button
                type="button"
                disabled={editingId != null}
                onClick={() => setForm(f => ({ ...f, templateType: 'internal' }))}
                className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed ${form.templateType === 'internal' ? 'border-wa-primary bg-green-50 ring-1 ring-wa-primary/30 dark:bg-green-950/30' : 'border-wa-border hover:border-wa-primary/50 dark:border-wa-border-dark'}`}
              >
                <MessageSquareText className="mt-0.5 h-5 w-5 shrink-0 text-wa-primary-strong" />
                <span><span className="block text-sm font-semibold">Plantilla interna</span><span className="block text-xs text-wa-muted dark:text-wa-muted-dark">Respuesta rápida; requiere ventana abierta.</span></span>
              </button>
              <button
                type="button"
                disabled={editingId != null}
                onClick={() => setForm(f => ({ ...f, templateType: 'official' }))}
                className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed ${form.templateType === 'official' ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500/30 dark:bg-blue-950/30' : 'border-wa-border hover:border-blue-500/50 dark:border-wa-border-dark'}`}
              >
                <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                <span><span className="block text-sm font-semibold">Plantilla oficial</span><span className="block text-xs text-wa-muted dark:text-wa-muted-dark">Aprobada por Meta; puede reabrir una conversación.</span></span>
              </button>
            </div>
            {form.templateType === 'internal' && (
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-wa-hover p-1.5 dark:bg-wa-panel-dark/50" aria-label="Formato del mensaje interno">
                {([
                  ['none', MessageSquareText, 'Texto'],
                  ['buttons', MousePointerClick, 'Botones'],
                  ['list', ListIcon, 'Lista'],
                ] as const).map(([value, Icon, label]) => (
                  <button key={value} type="button" onClick={() => { setForm(f => ({ ...f, interactiveType: value })); if (value !== 'none') setPendingAttachments([]) }} className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold ${form.interactiveType === value ? 'bg-white text-wa-primary-strong shadow-sm dark:bg-wa-active-dark dark:text-wa-primary' : 'text-wa-muted dark:text-wa-muted-dark'}`}><Icon className="h-3.5 w-3.5" />{label}</button>
                ))}
              </div>
            )}
            {form.templateType === 'official' && (
              <div className="grid gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/20 md:grid-cols-2">
                <div className="md:col-span-2"><h3 className="text-sm font-bold text-blue-800 dark:text-blue-300">Configuración de Meta</h3><p className="mt-1 text-xs text-wa-muted">Datos que Meta revisará antes de permitir el envío.</p></div>
                <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">Nombre para Meta
                  <input required disabled={editingTemplate?.meta_template_id != null} maxLength={512} pattern="[a-z0-9_]+" value={form.officialName} onChange={event => setForm(f => ({ ...f, officialName: event.target.value.toLowerCase() }))} placeholder="seguimiento_cliente" className="rounded-md border border-blue-200 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-blue-900 dark:bg-wa-panel-dark" />
                </label>
                <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">Idioma
                  <input required disabled={editingTemplate?.meta_template_id != null} maxLength={6} pattern="[a-z]{2,3}(_[A-Z]{2})?" value={form.officialLanguage} onChange={event => setForm(f => ({ ...f, officialLanguage: event.target.value }))} placeholder="es" className="rounded-md border border-blue-200 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-blue-900 dark:bg-wa-panel-dark" />
                </label>
                <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">Categoría oficial
                  <Select value={form.officialCategory} onChange={event => setForm(f => ({ ...f, officialCategory: event.target.value as NonNullable<MessageTemplate['official_category']> }))} className="rounded-md border border-blue-200 bg-white px-3 py-2 text-sm dark:border-blue-900 dark:bg-wa-panel-dark"><option value="UTILITY">Utility</option><option value="MARKETING">Marketing</option><option value="AUTHENTICATION">Authentication</option></Select>
                </label>
                <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">Encabezado
                  <Select value={form.officialHeaderType} onChange={event => setForm(f => ({ ...f, officialHeaderType: event.target.value as MessageTemplate['official_header_type'] }))} className="rounded-md border border-blue-200 bg-white px-3 py-2 text-sm dark:border-blue-900 dark:bg-wa-panel-dark"><option value="none">Sin encabezado</option><option value="text">Texto</option><option value="image">Imagen</option></Select>
                </label>
                {form.officialHeaderType === 'text' && (
                  <label className="templates-field md:col-span-2">Texto del encabezado<input required maxLength={60} value={form.officialHeaderText} onChange={event => setForm(f => ({ ...f, officialHeaderText: event.target.value }))} placeholder="Título breve, sin variables" className="rounded-md border border-blue-200 bg-white px-3 py-2 text-sm dark:border-blue-900 dark:bg-wa-panel-dark" /></label>
                )}
                {form.officialHeaderType === 'image' && (
                  <div className="md:col-span-2">
                    <MediaAssetField mediaAssetId={form.officialHeaderMediaAssetId} mediaAssets={mediaAssets} kind="image" onChange={id => setForm(f => ({ ...f, officialHeaderMediaAssetId: id }))} />
                    <p className="mt-1 text-[11px] text-wa-muted">Se sube a Meta como ejemplo del encabezado al guardar. Requiere tener configurado el Facebook App ID en Configuración → Evolution API.</p>
                  </div>
                )}
                <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300 md:col-span-2">Pie de página (opcional)
                  <input maxLength={60} value={form.officialFooter} onChange={event => setForm(f => ({ ...f, officialFooter: event.target.value }))} placeholder="Sin variables" className="rounded-md border border-blue-200 bg-white px-3 py-2 text-sm dark:border-blue-900 dark:bg-wa-panel-dark" />
                </label>
                <div className="grid gap-2 md:col-span-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Botones (opcional)</span>
                    <button
                      type="button"
                      disabled={form.officialButtons.length >= 3}
                      onClick={() => setForm(f => ({ ...f, officialButtons: [...f.officialButtons, { type: 'quick_reply', text: '' }] }))}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-40 dark:text-blue-300 dark:hover:bg-blue-950/50"
                    >
                      <Plus className="h-3.5 w-3.5" /> Agregar botón
                    </button>
                  </div>
                  {form.officialButtons.map((button, index) => (
                    <div key={index} className="grid gap-2 rounded-lg border border-blue-200 bg-white p-2 dark:border-blue-900 dark:bg-wa-panel-dark md:grid-cols-[130px_1fr_1fr_auto]">
                      <Select
                        value={button.type}
                        onChange={event => setForm(f => ({ ...f, officialButtons: f.officialButtons.map((item, itemIndex) => itemIndex === index ? { type: event.target.value as OfficialTemplateButton['type'], text: item.text } : item) }))}
                        className="rounded border border-wa-border px-2 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-head-dark"
                      >
                        <option value="quick_reply">Respuesta rápida</option>
                        <option value="url">URL</option>
                        <option value="phone_number">Teléfono</option>
                      </Select>
                      <input required maxLength={25} value={button.text} onChange={event => setForm(f => ({ ...f, officialButtons: f.officialButtons.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) }))} placeholder="Texto visible" className="rounded border border-wa-border px-2 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-head-dark" />
                      {button.type === 'url' && (
                        <input required value={button.url ?? ''} onChange={event => setForm(f => ({ ...f, officialButtons: f.officialButtons.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item) }))} placeholder="https://..." className="rounded border border-wa-border px-2 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-head-dark" />
                      )}
                      {button.type === 'phone_number' && (
                        <input required value={button.phone_number ?? ''} onChange={event => setForm(f => ({ ...f, officialButtons: f.officialButtons.map((item, itemIndex) => itemIndex === index ? { ...item, phone_number: event.target.value } : item) }))} placeholder="+51987654321" className="rounded border border-wa-border px-2 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-head-dark" />
                      )}
                      {button.type === 'quick_reply' && <div />}
                        <button type="button" aria-label={`Quitar botón ${index + 1}`} onClick={() => setForm(f => ({ ...f, officialButtons: f.officialButtons.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded p-1 text-red-500"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <p className="text-[11px] text-wa-muted">Máximo 3 de respuesta rápida, o 2 combinando URL/teléfono. No se pueden mezclar.</p>
                </div>
                <p className="text-[11px] text-blue-700 dark:text-blue-300 md:col-span-2">
                  {editingTemplate?.meta_template_id != null
                    ? 'Ya fue enviada a Meta: nombre e idioma no se pueden cambiar. Los demás cambios se reenvían para revisión.'
                    : 'Al guardar se envía a Meta para revisión. El estado se sincroniza desde la lista con el botón de actualizar.'}
                </p>
              </div>
            )}
            <div className="templates-section-label"><span>02</span><div><strong>Contenido del mensaje</strong><p>Define el nombre, atajo y texto que verá el cliente.</p></div></div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="templates-field">Nombre de la plantilla <span aria-hidden="true">*</span><input
                required
                maxLength={120}
                placeholder="Nombre"
                value={form.name}
                onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                className="rounded-md border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
              /></label>
              <label className="templates-field">Atajo <small>Opcional · úsalo escribiendo /atajo</small><input
                maxLength={50}
                pattern="[a-zA-Z0-9_-]*"
                placeholder="Atajo, ej. cotizacion"
                value={form.shortcut}
                onChange={(event) => setForm((f) => ({ ...f, shortcut: event.target.value }))}
                className="rounded-md border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
              /></label>
            </div>
            <label className="templates-field">Mensaje <span aria-hidden="true">*</span><textarea
              required
              maxLength={form.templateType === 'official' || form.interactiveType !== 'none' ? 1024 : 4096}
              rows={4}
              placeholder={form.templateType === 'official' ? 'Hola {{1}}, queremos continuar con tu solicitud...' : 'Hola {{nombre}}, ...'}
              value={form.content}
              onChange={(event) => setForm((f) => ({
                ...f,
                content: event.target.value,
                officialParameterValues: form.templateType === 'official'
                  ? resizeOfficialParameters(event.target.value, f.officialParameterValues)
                  : f.officialParameterValues,
              }))}
              className="rounded-md border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
            /><small>{form.content.length}/{form.templateType === 'official' || form.interactiveType !== 'none' ? 1024 : 4096} caracteres</small></label>
            <div className="templates-section-label"><span>03</span><div><strong>Organización y uso</strong><p>Clasifica la plantilla para encontrarla y aplicarla con rapidez.</p></div></div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="templates-field">
                <span>Categoría <span aria-hidden="true">*</span></span>
                <div className="flex items-center gap-2">
                  <Select
                    required
                    aria-label="Categoría"
                    value={form.category}
                    disabled={categoriesLoading}
                    onChange={(event) => setForm((f) => ({ ...f, category: event.target.value }))}
                    className="min-w-0 flex-1 rounded-md border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
                  >
                    <option value="" disabled>{categoriesLoading ? 'Cargando categorías…' : 'Selecciona una categoría'}</option>
                    {!templateCategories.some(category => category.name === form.category) && form.category && (
                      <option value={form.category}>{form.category} (inactiva)</option>
                    )}
                    {templateCategories.map(category => <option key={category.id} value={category.name}>{category.name}</option>)}
                  </Select>
                  <button
                    type="button"
                    onClick={() => setCategoryFormOpen(value => !value)}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-2 text-xs font-semibold text-wa-primary-strong hover:bg-green-50 dark:text-wa-primary dark:hover:bg-green-950/30"
                  >
                    <Plus className="h-3.5 w-3.5" /> Nueva
                  </button>
                </div>
                {categoryFormOpen && (
                  <div className="flex gap-2 rounded-lg border border-wa-border bg-wa-hover p-2 dark:border-wa-border-dark dark:bg-wa-panel-dark">
                    <input
                      autoFocus
                      value={newCategoryName}
                      onChange={event => setNewCategoryName(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          handleCreateCategory()
                        }
                      }}
                      maxLength={60}
                      placeholder="Nueva categoría"
                      className="min-w-0 flex-1 rounded-md border border-wa-border bg-white px-2.5 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-head-dark"
                    />
                    <button
                      type="button"
                      disabled={!newCategoryName.trim() || createCategory.isPending}
                      onClick={handleCreateCategory}
                      className="rounded-md bg-wa-primary px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      {createCategory.isPending ? 'Creando…' : 'Crear'}
                    </button>
                  </div>
                )}
              </div>
              <label className="templates-field">Etapa del lead<Select
                value={form.stage}
                onChange={(event) => { const value = event.target.value; setForm((f) => ({ ...f, stage: value === '' || isLeadStage(value) ? value : f.stage })) }}
                className="rounded-md border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
              >
                <option value="">Cualquier etapa</option>
                {LEAD_STAGES.map((x) => <option key={x} value={x}>{x}</option>)}
              </Select></label>
              <label className="templates-field">Tipo de tarea<Select
                value={form.taskType}
                onChange={(event) => { const value = event.target.value; setForm((f) => ({ ...f, taskType: value === '' || isTaskType(value) ? value : f.taskType })) }}
                className="rounded-md border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
              >
                <option value="">Cualquier tarea</option>
                {TASK_TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </Select></label>
            </div>
            {form.templateType === 'official' ? (
              <div className="grid gap-2 rounded-lg border border-wa-border p-3 dark:border-wa-border-dark">
                <p className="text-xs text-wa-muted dark:text-wa-muted-dark">El texto aprobado usa variables numéricas consecutivas: {'{{1}}'}, {'{{2}}'}, ... Configura qué dato enviará el CRM en cada posición.</p>
                {form.officialParameterValues.map((value, index) => (
                  <label key={index} className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300 sm:grid-cols-[80px_1fr] sm:items-center"><span>{`{{${index + 1}}}`}</span><input required value={value} onChange={event => setForm(f => ({ ...f, officialParameterValues: f.officialParameterValues.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} placeholder="Ej. {{nombre}}" className="rounded-md border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-panel-dark" /></label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
                Variables: {'{{nombre}}'}, {'{{telefono}}'}, {'{{servicio}}'}, {'{{vendedor}}'}, {'{{fecha_actual}}'}
              </p>
            )}
            {form.templateType === 'internal' && form.interactiveType !== 'none' && (
              <div className="grid gap-3 rounded-xl border border-green-200 bg-green-50/50 p-3 dark:border-green-900 dark:bg-green-950/20">
                <div><h3 className="text-sm font-bold text-wa-primary-strong dark:text-wa-primary">Opciones interactivas</h3><p className="mt-1 text-xs text-wa-muted">Configura las respuestas que podrá elegir el cliente.</p></div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">Título interactivo
                    <input required maxLength={60} value={form.interactiveTitle} onChange={event => setForm(f => ({ ...f, interactiveTitle: event.target.value }))} placeholder="Elige una opción" className="rounded-md border border-green-200 bg-white px-3 py-2 text-sm dark:border-green-900 dark:bg-wa-panel-dark" />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">Pie de mensaje
                    <input maxLength={capabilities?.interactive_limits.footer} value={form.interactiveFooter} onChange={event => setForm(f => ({ ...f, interactiveFooter: event.target.value }))} placeholder={capabilities?.interactive_default_footer} className="rounded-md border border-green-200 bg-white px-3 py-2 text-sm dark:border-green-900 dark:bg-wa-panel-dark" />
                  </label>
                </div>
                {form.interactiveType === 'buttons' && (
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between"><p className="text-xs font-semibold text-gray-700 dark:text-wa-text-dark">Botones (máximo 3 respuestas)</p><button type="button" disabled={form.interactiveButtons.length >= maxInteractiveButtons} onClick={() => setForm(f => ({ ...f, interactiveButtons: [...f.interactiveButtons, { type: 'reply', displayText: '', id: `reply_${f.interactiveButtons.length + 1}` }] }))} className="flex items-center gap-1 text-xs font-medium text-wa-primary-strong disabled:opacity-40 dark:text-wa-primary"><Plus className="h-3 w-3" />Agregar</button></div>
                    {form.interactiveButtons.map((button, index) => (
                      <div key={index} className="grid gap-2 rounded-lg border border-green-200 bg-white p-2 dark:border-green-900 dark:bg-wa-panel-dark md:grid-cols-[1fr_1fr_auto]">
                        <input required maxLength={20} value={button.displayText} onChange={event => setForm(f => ({ ...f, interactiveButtons: f.interactiveButtons.map((item, itemIndex) => itemIndex === index ? { ...item, displayText: event.target.value } : item) }))} placeholder="Texto visible" className="rounded border border-wa-border px-2 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-head-dark" />
                        <input required maxLength={256} value={button.id ?? ''} onChange={event => setForm(f => ({ ...f, interactiveButtons: f.interactiveButtons.map((item, itemIndex) => itemIndex === index ? { ...item, id: event.target.value } : item) }))} placeholder="ID de respuesta" className="rounded border border-wa-border px-2 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-head-dark" />
                        <button type="button" disabled={form.interactiveButtons.length === 1} onClick={() => setForm(f => ({ ...f, interactiveButtons: f.interactiveButtons.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded p-1 text-red-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))}
                    <p className="text-[11px] text-wa-muted">Meta solo admite botones de respuesta rápida fuera de una plantilla oficial. Para URL, llamada o copiar código, usá una plantilla oficial.</p>
                  </div>
                )}
                {form.interactiveType === 'list' && (
                  <div className="grid gap-2">
                    <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">Texto del botón que abre la lista
                      <input required maxLength={20} value={form.interactiveButtonText} onChange={event => setForm(f => ({ ...f, interactiveButtonText: event.target.value }))} placeholder="Ver opciones" className="rounded-md border border-green-200 bg-white px-3 py-2 text-sm dark:border-green-900 dark:bg-wa-panel-dark" />
                    </label>
                    <div className="flex items-center justify-between"><p className="text-xs font-semibold text-gray-700 dark:text-wa-text-dark">Secciones y opciones ({totalInteractiveRows}/10)</p><button type="button" disabled={form.interactiveSections.length >= 10 || totalInteractiveRows >= 10} onClick={() => setForm(f => ({ ...f, interactiveSections: [...f.interactiveSections, { title: `Sección ${f.interactiveSections.length + 1}`, rows: [{ title: '', description: '', rowId: `option_${f.interactiveSections.length + 1}_1` }] }] }))} className="flex items-center gap-1 text-xs font-medium text-wa-primary-strong disabled:opacity-40 dark:text-wa-primary"><Plus className="h-3 w-3" />Sección</button></div>
                    {form.interactiveSections.map((section, sectionIndex) => (
                      <div key={sectionIndex} className="grid gap-2 rounded-lg border border-green-200 bg-white p-3 dark:border-green-900 dark:bg-wa-panel-dark">
                        <div className="flex gap-2"><input required maxLength={24} value={section.title} onChange={event => setForm(f => ({ ...f, interactiveSections: f.interactiveSections.map((item, index) => index === sectionIndex ? { ...item, title: event.target.value } : item) }))} placeholder="Título de sección" className="min-w-0 flex-1 rounded border border-wa-border px-2 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-head-dark" /><button type="button" disabled={form.interactiveSections.length === 1} onClick={() => setForm(f => ({ ...f, interactiveSections: f.interactiveSections.filter((_, index) => index !== sectionIndex) }))} className="rounded p-1 text-red-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>
                        {section.rows.map((row, rowIndex) => <div key={rowIndex} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]"><input required maxLength={24} value={row.title} onChange={event => setForm(f => ({ ...f, interactiveSections: f.interactiveSections.map((item, index) => index === sectionIndex ? { ...item, rows: item.rows.map((option, optionIndex) => optionIndex === rowIndex ? { ...option, title: event.target.value } : option) } : item) }))} placeholder="Opción" className="rounded border border-wa-border px-2 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-head-dark" /><input required value={row.description} maxLength={72} onChange={event => setForm(f => ({ ...f, interactiveSections: f.interactiveSections.map((item, index) => index === sectionIndex ? { ...item, rows: item.rows.map((option, optionIndex) => optionIndex === rowIndex ? { ...option, description: event.target.value } : option) } : item) }))} placeholder="Descripción obligatoria" className="rounded border border-wa-border px-2 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-head-dark" /><input required maxLength={200} value={row.rowId} onChange={event => setForm(f => ({ ...f, interactiveSections: f.interactiveSections.map((item, index) => index === sectionIndex ? { ...item, rows: item.rows.map((option, optionIndex) => optionIndex === rowIndex ? { ...option, rowId: event.target.value } : option) } : item) }))} placeholder="ID único" className="rounded border border-wa-border px-2 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-head-dark" /><button type="button" disabled={section.rows.length === 1} onClick={() => setForm(f => ({ ...f, interactiveSections: f.interactiveSections.map((item, index) => index === sectionIndex ? { ...item, rows: item.rows.filter((_, optionIndex) => optionIndex !== rowIndex) } : item) }))} className="rounded p-1 text-red-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>)}
                        <button type="button" disabled={totalInteractiveRows >= 10} onClick={() => setForm(f => ({ ...f, interactiveSections: f.interactiveSections.map((item, index) => index === sectionIndex ? { ...item, rows: [...item.rows, { title: '', description: '', rowId: `option_${sectionIndex + 1}_${item.rows.length + 1}` }] } : item) }))} className="flex items-center gap-1 text-xs font-medium text-wa-primary-strong disabled:opacity-40 dark:text-wa-primary"><Plus className="h-3 w-3" />Agregar opción</button>
                      </div>
                    ))}
                    <p className="text-[11px] text-wa-muted">Máximo 10 opciones en total. Los IDs no son visibles para el cliente.</p>
                  </div>
                )}
              </div>
            )}
            {form.templateType === 'internal' && form.interactiveType === 'none' && <div
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`rounded-2xl border-2 border-dashed p-4 transition-colors ${
                isDraggingFiles
                  ? 'border-wa-primary bg-green-50 dark:border-wa-primary dark:bg-green-950/30'
                  : 'border-gray-300 dark:border-gray-600'
              }`}
            >
              <div className="mb-2 text-center"><h3 className="text-sm font-bold text-wa-text dark:text-white">Adjuntos</h3><p className="mt-1 text-xs text-wa-muted">Añade archivos a esta respuesta rápida.</p></div>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 py-2 text-center text-sm font-medium text-gray-600 hover:text-wa-primary-strong dark:text-gray-300 dark:hover:text-wa-primary">
                {isDraggingFiles ? <UploadCloud className="h-7 w-7 text-wa-primary-strong" /> : <ImagePlus className="h-6 w-6" />}
                <span>{isDraggingFiles ? 'Suelta los archivos aquí' : 'Arrastra archivos aquí o haz clic para seleccionarlos'}</span>
                <span className="text-xs font-normal text-wa-muted">Imágenes, videos, audios o documentos</span>
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
              <p className="mt-2 text-center text-[11px] leading-relaxed text-wa-muted dark:text-wa-muted-dark">
                Con imagen, video o documento, el contenido de hasta 1024 caracteres se enviará como caption mediante Evolution. Con audio o textos más largos se enviará por separado.
              </p>
              {((editingTemplate?.attachments.length ?? 0) > 0 || pendingAttachments.length > 0) && (
                <div className="mt-3 space-y-1">
                  {editingTemplate?.attachments.map(attachment => {
                    const isDeleting = deleteAttachment.isPending && deleteAttachment.variables === attachment.id
                    return (
                    <div key={attachment.id} aria-busy={isDeleting} className={`flex items-center justify-between gap-3 rounded-md border border-wa-border bg-wa-hover px-3 py-2 text-xs text-gray-700 transition-opacity dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark ${isDeleting ? 'opacity-70' : ''}`}>
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-violet-500 dark:text-violet-400" />
                        <span className="truncate" title={attachment.filename}>{attachment.filename}</span>
                        <span className="hidden shrink-0 rounded bg-wa-border px-1.5 py-0.5 text-[10px] uppercase text-gray-600 dark:bg-wa-active-dark dark:text-gray-300 sm:inline">
                          {attachment.content_type.split('/')[0] || 'archivo'}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteAttachment(attachment.id, attachment.filename)}
                        disabled={deleteAttachment.isPending}
                        title={isDeleting ? 'Quitando adjunto…' : 'Quitar adjunto'}
                        aria-label={isDeleting ? `Quitando ${attachment.filename}` : `Quitar ${attachment.filename}`}
                        className="shrink-0 rounded p-1 text-red-500 hover:bg-red-100 hover:text-red-700 disabled:cursor-wait disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/50 dark:hover:text-red-300"
                      >
                        {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </div>
                    )
                  })}
                  {pendingAttachments.map(attachment => {
                    const filename = attachment.source === 'upload' ? attachment.file.name : attachment.asset.filename
                    const contentType = attachment.source === 'upload' ? attachment.file.type : attachment.asset.content_type
                    return (
                      <div key={attachment.key} className="flex items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">
                        <span className="flex min-w-0 items-center gap-2">
                          {attachment.source === 'library' && <FolderOpen className="h-3.5 w-3.5 shrink-0" />}
                          {attachment.source === 'upload' && <FileText className="h-4 w-4 shrink-0" />}
                          <span className="truncate" title={filename}>{filename}</span>
                          <span className="hidden shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] uppercase text-wa-primary-strong dark:bg-green-900/60 dark:text-green-300 sm:inline">
                            {contentType.split('/')[0] || 'archivo'}
                          </span>
                        </span>
                        <button type="button" onClick={() => setPendingAttachments(items => items.filter(item => item.key !== attachment.key))} title="Quitar adjunto" className="shrink-0 rounded p-1 text-red-500 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950/50"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    )
                  })}
                </div>
              )}
              <p className="mt-2 text-[11px] text-wa-muted">Máximo 25 MB por archivo. Se enviarán en el orden agregado.</p>
            </div>}
            {libraryOpen && (
              <MediaLibraryPicker
                selectedIds={selectedLibraryIds}
                disabledIds={existingLibraryIds}
                canSelect={canAddAttachment}
                onSelect={addFromLibrary}
                onClose={() => setLibraryOpen(false)}
              />
            )}
            <div className="templates-form-actions flex flex-wrap gap-2">
              <button type="submit"
                disabled={isSaving}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-wa-primary-strong px-5 py-2.5 text-sm font-semibold text-white hover:bg-wa-primary disabled:opacity-40"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId != null ? 'Guardar cambios' : 'Guardar plantilla'}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-xl border border-wa-border px-5 py-2.5 text-sm font-semibold text-wa-muted hover:bg-wa-field dark:border-wa-border-dark dark:text-wa-muted-dark dark:hover:text-wa-text-dark"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        <div className="templates-list-heading"><div><h2 className="text-lg font-bold text-wa-text dark:text-white">Plantillas del equipo</h2><p className="mt-1 text-sm text-wa-muted">Administra el contenido disponible para tus conversaciones.</p></div><span>{data.length} {data.length === 1 ? 'plantilla' : 'plantillas'}</span></div>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-wa-muted" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {data.map((template) => {
              const isTogglingActive = updateTemplate.isPending
                && updateTemplate.variables?.id === template.id
                && updateTemplate.variables?.is_active !== undefined
              const isDeleting = deleteTemplate.isPending && deleteTemplate.variables === template.id

              return (
              <article
                key={template.id}
                aria-busy={isTogglingActive || isDeleting}
                className={`templates-card rounded-2xl border border-wa-border bg-white p-5 shadow-sm dark:border-wa-border-dark dark:bg-wa-head-dark ${!template.is_active ? 'opacity-60' : ''}`}
              >
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h2 className="truncate font-medium text-wa-text dark:text-white">{template.name}</h2>
                      {template.is_favorite && <Star className="h-3.5 w-3.5 shrink-0 fill-yellow-400 text-yellow-400" />}
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${template.template_type === 'official' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'bg-wa-field text-gray-600 dark:bg-wa-active-dark dark:text-gray-300'}`}>{template.template_type === 'official' ? 'Oficial' : 'Interna'}</span>
                      {template.imported_from_meta && <span title="Importada desde Meta: borrarla acá no la borra de la WABA" className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-purple-700 dark:bg-purple-950 dark:text-purple-300">Importada</span>}
                      {template.interactive_type !== 'none' && <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-wa-primary-strong dark:bg-green-950 dark:text-green-300">{template.interactive_type === 'buttons' ? 'Botones' : 'Lista'}</span>}
                    </div>
                    <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
                      {template.category}
                      {template.shortcut ? ` · /${template.shortcut}` : ''}
                      {template.visibility === 'personal' ? ' · Personal' : ' · Equipo'}
                      {template.use_count > 0 ? ` · Usada ${template.use_count}x` : ''}
                    </p>
                    <p className="mt-0.5 text-[10px] text-wa-muted dark:text-wa-muted-dark">
                      Creada por {template.created_by_name ?? 'Usuario eliminado'}
                      {template.created_at ? ` · ${new Date(template.created_at).toLocaleDateString('es-PE')}` : ''}
                    </p>
                    {template.template_type === 'official' && (
                      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-blue-600 dark:text-blue-400">
                        {template.official_name} · {template.official_language} · {template.official_category} · <span className="font-semibold">{template.official_status ?? 'sin estado'}</span>
                        {template.meta_template_id != null && (
                          <button
                            type="button"
                            onClick={() => handleSyncTemplate(template.id)}
                            disabled={syncTemplate.isPending}
                            title="Sincronizar estado con Meta"
                            aria-label="Sincronizar estado con Meta"
                            className="rounded p-0.5 text-blue-500 hover:bg-blue-100 disabled:opacity-40 dark:text-blue-400 dark:hover:bg-blue-950/50"
                          >
                            <RefreshCw className={`h-3 w-3 ${syncTemplate.isPending && syncTemplate.variables === template.id ? 'animate-spin' : ''}`} />
                          </button>
                        )}
                      </p>
                    )}
                    {template.official_status === 'REJECTED' && template.official_rejected_reason && (
                      <p className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">
                        Motivo: {rejectedReasonLabel(template.official_rejected_reason)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title="Editar"
                      onClick={() => openEditForm(template)}
                      className="rounded-md p-1 hover:bg-wa-field dark:hover:bg-wa-active-dark"
                    >
                      <Pencil className="h-4 w-4 text-wa-muted hover:text-wa-primary-strong" />
                    </button>
                    <button
                      type="button"
                      disabled={updateTemplate.isPending}
                      aria-busy={isTogglingActive}
                      aria-label={isTogglingActive ? 'Actualizando estado de la plantilla' : template.is_active ? 'Desactivar plantilla' : 'Activar plantilla'}
                      title={isTogglingActive ? 'Actualizando…' : template.is_active ? 'Desactivar' : 'Activar'}
                      onClick={() => handleToggleActive(template.id, !template.is_active)}
                      className="rounded-md p-1 hover:bg-wa-field disabled:cursor-wait disabled:opacity-50 dark:hover:bg-wa-active-dark"
                    >
                      {isTogglingActive
                        ? <Loader2 className="h-4 w-4 animate-spin text-wa-muted" />
                        : <Power className={`h-4 w-4 ${template.is_active ? 'text-wa-primary-strong' : 'text-wa-muted'}`} />}
                    </button>
                    <ConfirmDialog
                      title={`Eliminar “${template.name}”`}
                      description={
                        template.template_type === 'official' && template.meta_template_id != null && !template.imported_from_meta
                          ? "La plantilla desaparecerá para todos y también se borrará de Meta (WhatsApp Business). Si una automatización todavía la usa, el sistema impedirá el borrado."
                          : template.imported_from_meta
                            ? "La plantilla desaparecerá de la app, pero seguirá existiendo en Meta (WhatsApp Business) — podés volver a importarla cuando quieras. Si una automatización todavía la usa, el sistema impedirá el borrado."
                            : "La plantilla desaparecerá para todos. Sus archivos permanecerán en la biblioteca multimedia. Si una automatización todavía la usa, el sistema impedirá el borrado."
                      }
                      confirmLabel="Eliminar plantilla"
                      disabled={deleteTemplate.isPending}
                      onConfirm={() => handleDeleteTemplate(template.id, template.name)}
                    >
                      <button
                        type="button"
                        disabled={deleteTemplate.isPending}
                        aria-busy={isDeleting}
                        aria-label={isDeleting ? 'Eliminando plantilla' : `Eliminar ${template.name}`}
                        title={isDeleting ? 'Eliminando…' : 'Eliminar'}
                        className="rounded-md p-1 text-red-500 hover:bg-red-50 disabled:cursor-wait disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </ConfirmDialog>
                  </div>
                </div>
                <p className="templates-card-content mt-4 whitespace-pre-wrap text-sm leading-6 text-gray-600 dark:text-gray-300">{template.content}</p>
                {template.attachments.length>0&&<div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400"><ImagePlus className="h-3.5 w-3.5"/>{template.attachments.length} adjunto{template.attachments.length===1?'':'s'}</div>}
              </article>
              )
            })}
            {data.length === 0 && (
              <div className="templates-empty md:col-span-2"><span><MessageSquareText className="h-7 w-7" /></span><h3>Aún no hay plantillas</h3><p>Crea una respuesta para el equipo o importa las que ya tengas aprobadas en Meta.</p>{!open && <button type="button" onClick={openCreateForm}><Plus className="h-4 w-4" /> Crear primera plantilla</button>}</div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
