import { useRef, useState } from 'react'
import { AlertTriangle, BadgeCheck, FileText, FolderOpen, ImagePlus, List as ListIcon, Loader2, MessageSquareText, MousePointerClick, Pencil, Plus, Power, Star, Trash2, UploadCloud } from 'lucide-react'
import type { LeadStage, MediaAsset, MessageTemplate, TaskType, TemplateInteractiveButton, TemplateInteractiveSection } from '../types'
import { LEAD_STAGES, isLeadStage } from '../types'
import { useAddLibraryTemplateAttachment, useCreateTemplate, useDeleteTemplateAttachment, useTemplateCapabilities, useTemplates, useUpdateTemplate, useUploadTemplateAttachment } from '../hooks/useTemplates'
import { extractErrorMessage } from '../utils/errors'
import { MediaLibraryPicker } from './MediaLibraryPicker'
import { TASK_TYPE_OPTIONS as TASK_TYPES, isTaskType } from '../domain/automationCatalog'

interface TemplateFormState {
  name: string
  shortcut: string
  content: string
  category: string
  stage: LeadStage | ''
  taskType: TaskType | ''
  templateType: MessageTemplate['template_type']
  officialName: string
  officialLanguage: string
  officialCategory: NonNullable<MessageTemplate['official_category']>
  officialStatus: NonNullable<MessageTemplate['official_status']>
  officialParameterValues: string[]
  interactiveType: MessageTemplate['interactive_type']
  interactiveTitle: string
  interactiveFooter: string
  interactiveButtonText: string
  interactiveButtons: TemplateInteractiveButton[]
  interactiveSections: TemplateInteractiveSection[]
}

const EMPTY_FORM: TemplateFormState = {
  name: '',
  shortcut: '',
  content: '',
  category: 'seguimiento',
  stage: '',
  taskType: '',
  templateType: 'internal',
  officialName: '',
  officialLanguage: 'es',
  officialCategory: 'UTILITY',
  officialStatus: 'PENDING',
  officialParameterValues: [],
  interactiveType: 'none',
  interactiveTitle: '',
  interactiveFooter: 'DermicaPro',
  interactiveButtonText: 'Ver opciones',
  interactiveButtons: [{ type: 'reply', displayText: '', id: 'reply_1' }],
  interactiveSections: [{ title: 'Opciones', rows: [{ title: '', description: '', rowId: 'option_1' }] }],
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
const ALLOWED_INTERNAL_VARIABLES = new Set(['nombre', 'telefono', 'servicio', 'vendedor', 'fecha_actual'])

function templateVariables(...values: string[]) {
  return new Set(values.flatMap(value => Array.from(value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), match => match[1].trim())))
}

function validateTemplateForm(form: typeof EMPTY_FORM) {
  const errors: string[] = []
  const name = form.name.trim()
  const content = form.content.trim()
  const category = form.category.trim()
  const shortcut = form.shortcut.trim().replace(/^\/+/, '').toLowerCase()
  const interactive = form.templateType === 'internal' && form.interactiveType !== 'none'
  const contentLimit = interactive || form.templateType === 'official' ? 1024 : 4096

  if (!name) errors.push('El nombre es obligatorio.')
  else if (name.length > 120) errors.push('El nombre admite máximo 120 caracteres.')
  if (!content) errors.push('El contenido es obligatorio.')
  else if (content.length > contentLimit) errors.push(`El contenido admite máximo ${contentLimit} caracteres para este tipo de plantilla.`)
  if (!category) errors.push('La categoría es obligatoria.')
  else if (category.length > 60) errors.push('La categoría admite máximo 60 caracteres.')
  if (shortcut && (shortcut.length > 50 || !/^[a-z0-9_-]+$/.test(shortcut))) {
    errors.push('El atajo admite máximo 50 caracteres: letras minúsculas, números, - y _.')
  }

  if (form.templateType === 'official') {
    const officialName = form.officialName.trim()
    if (!/^[a-z0-9_]+$/.test(officialName) || officialName.length > 512) {
      errors.push('El nombre oficial admite minúsculas, números y guiones bajos (máximo 512).')
    }
    if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(form.officialLanguage.trim())) {
      errors.push('El idioma oficial debe tener un formato como es, es_PE o en_US.')
    }
    const officialVariables = templateVariables(content)
    if ([...officialVariables].some(value => !/^\d+$/.test(value))) {
      errors.push('El contenido oficial solo admite variables numéricas como {{1}}, {{2}}, ...')
    }
    const positions = [...officialVariables].filter(value => /^\d+$/.test(value)).map(Number).sort((a, b) => a - b)
    const expected = Array.from({ length: positions.at(-1) ?? 0 }, (_, index) => index + 1)
    if (positions.length !== expected.length || positions.some((value, index) => value !== expected[index])) {
      errors.push('Las variables oficiales deben ser consecutivas: {{1}}, {{2}}, ...')
    }
    if (form.officialParameterValues.length !== expected.length || form.officialParameterValues.some(value => !value.trim())) {
      errors.push('Configura un valor para cada variable oficial.')
    }
    const unknownParameters = [...templateVariables(...form.officialParameterValues)].filter(value => !ALLOWED_INTERNAL_VARIABLES.has(value))
    if (unknownParameters.length) errors.push(`Variables no reconocidas en los parámetros: ${unknownParameters.map(value => `{{${value}}}`).join(', ')}.`)
    return errors
  }

  const interactiveValues = form.interactiveType === 'none' ? '' : JSON.stringify({
    title: form.interactiveTitle,
    footer: form.interactiveFooter,
    buttonText: form.interactiveButtonText,
    buttons: form.interactiveButtons,
    sections: form.interactiveSections,
  })
  const unknownVariables = [...templateVariables(content, interactiveValues)].filter(value => !ALLOWED_INTERNAL_VARIABLES.has(value))
  if (unknownVariables.length) errors.push(`Variables no reconocidas: ${unknownVariables.map(value => `{{${value}}}`).join(', ')}.`)
  if (!interactive) return errors

  const title = form.interactiveTitle.trim()
  const footer = form.interactiveFooter.trim() || 'DermicaPro'
  if (!title) errors.push('El título interactivo es obligatorio.')
  else if (title.length > 60) errors.push('El título interactivo admite máximo 60 caracteres.')
  if (footer.length > 60) errors.push('El pie de mensaje admite máximo 60 caracteres.')

  if (form.interactiveType === 'buttons') {
    const buttons = form.interactiveButtons
    const hasReply = buttons.some(button => button.type === 'reply')
    if (buttons.length < 1 || buttons.length > 3) errors.push('Configura entre 1 y 3 botones.')
    if (hasReply && buttons.some(button => button.type !== 'reply')) errors.push('Los botones de respuesta no pueden mezclarse con URL, llamada o copia.')
    if (!hasReply && buttons.length > 2) errors.push('WhatsApp admite máximo 2 botones de URL, llamada o copia.')
    const texts = new Set<string>()
    const ids = new Set<string>()
    buttons.forEach((button, index) => {
      const label = button.displayText.trim()
      if (!label) errors.push(`El botón ${index + 1} necesita texto visible.`)
      else if (label.length > 20) errors.push(`El texto del botón ${index + 1} admite máximo 20 caracteres.`)
      else if (texts.has(label.toLowerCase())) errors.push(`El texto del botón ${index + 1} está repetido.`)
      texts.add(label.toLowerCase())
      const field = button.type === 'reply' ? 'id' : button.type === 'url' ? 'url' : button.type === 'call' ? 'phoneNumber' : 'copyCode'
      const value = String(button[field] ?? '').trim()
      if (!value) errors.push(`Falta configurar el valor del botón ${index + 1}.`)
      if (field === 'id') {
        if (value.length > 256) errors.push(`El ID del botón ${index + 1} admite máximo 256 caracteres.`)
        if (ids.has(value)) errors.push(`El ID del botón ${index + 1} está repetido.`)
        ids.add(value)
      }
      if (field === 'url' && (!/^https:\/\/\S+$/i.test(value) || value.length > 2048)) errors.push(`La URL del botón ${index + 1} debe comenzar con https:// y admitir máximo 2048 caracteres.`)
      if (field === 'phoneNumber' && !/^\+?[1-9]\d{7,14}$/.test(value.replace(/[\s()-]/g, ''))) errors.push(`El teléfono del botón ${index + 1} debe incluir código de país y tener entre 8 y 15 dígitos.`)
      if (field === 'copyCode' && value.length > 256) errors.push(`El código del botón ${index + 1} admite máximo 256 caracteres.`)
    })
    return errors
  }

  if (!form.interactiveButtonText.trim()) errors.push('El texto que abre la lista es obligatorio.')
  else if (form.interactiveButtonText.trim().length > 20) errors.push('El texto que abre la lista admite máximo 20 caracteres.')
  if (!form.interactiveSections.length || form.interactiveSections.length > 10) errors.push('Configura entre 1 y 10 secciones.')
  const sectionTitles = new Set<string>()
  const rowIds = new Set<string>()
  let totalRows = 0
  form.interactiveSections.forEach((section, sectionIndex) => {
    const sectionTitle = section.title.trim()
    if (!sectionTitle) errors.push(`La sección ${sectionIndex + 1} necesita título.`)
    else if (sectionTitle.length > 24) errors.push(`El título de la sección ${sectionIndex + 1} admite máximo 24 caracteres.`)
    else if (sectionTitles.has(sectionTitle.toLowerCase())) errors.push(`El título de la sección ${sectionIndex + 1} está repetido.`)
    sectionTitles.add(sectionTitle.toLowerCase())
    if (!section.rows.length) errors.push(`La sección ${sectionIndex + 1} necesita al menos una opción.`)
    section.rows.forEach((row, rowIndex) => {
      totalRows += 1
      const prefix = `Opción ${rowIndex + 1} de la sección ${sectionIndex + 1}`
      if (!row.title.trim()) errors.push(`${prefix}: el título es obligatorio.`)
      else if (row.title.trim().length > 24) errors.push(`${prefix}: el título admite máximo 24 caracteres.`)
      if (!row.description.trim()) errors.push(`${prefix}: la descripción es obligatoria.`)
      else if (row.description.trim().length > 72) errors.push(`${prefix}: la descripción admite máximo 72 caracteres.`)
      if (!row.rowId.trim()) errors.push(`${prefix}: el ID es obligatorio.`)
      else if (row.rowId.trim().length > 200) errors.push(`${prefix}: el ID admite máximo 200 caracteres.`)
      else if (rowIds.has(row.rowId.trim())) errors.push(`${prefix}: el ID está repetido.`)
      rowIds.add(row.rowId.trim())
    })
  })
  if (totalRows > 10) errors.push('Una lista admite máximo 10 opciones en total.')
  return errors
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
  const { data: capabilities } = useTemplateCapabilities()
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
      templateType: template.template_type,
      officialName: template.official_name ?? '',
      officialLanguage: template.official_language ?? 'es',
      officialCategory: template.official_category ?? 'UTILITY',
      officialStatus: template.official_status ?? 'PENDING',
      officialParameterValues: template.official_parameter_values,
      interactiveType: template.interactive_type,
      interactiveTitle: template.interactive_config.title ?? '',
      interactiveFooter: template.interactive_config.footer?.trim() || template.interactive_config.footerText?.trim() || 'DermicaPro',
      interactiveButtonText: template.interactive_config.buttonText ?? 'Ver opciones',
      interactiveButtons: template.interactive_config.buttons ?? [{ type: 'reply', displayText: '', id: 'reply_1' }],
      interactiveSections: template.interactive_config.sections ?? [{ title: 'Opciones', rows: [{ title: '', description: '', rowId: 'option_1' }] }],
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
    const fileErrors = files.map(validateAttachmentFile).filter((value): value is string => value != null)
    const validFiles = files.filter(file => validateAttachmentFile(file) == null)
    const existingCount = editingTemplate?.attachments.length ?? 0
    const available = Math.max(0, 10 - existingCount - pendingAttachments.length)
    if (validFiles.length > available) fileErrors.push(`Solo puedes agregar ${available} archivo${available === 1 ? '' : 's'} más.`)
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
    const validationErrors = validateTemplateForm(form)
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
      official_status: form.templateType === 'official' ? form.officialStatus : null,
      official_parameter_values: form.templateType === 'official' ? form.officialParameterValues : [],
      interactive_type: form.templateType === 'internal' ? form.interactiveType : 'none',
      interactive_config: form.templateType !== 'internal' || form.interactiveType === 'none' ? {} : form.interactiveType === 'buttons' ? {
        title: form.interactiveTitle,
        footer: form.interactiveFooter.trim() || 'DermicaPro',
        buttons: form.interactiveButtons,
      } : {
        title: form.interactiveTitle,
        footerText: form.interactiveFooter.trim() || 'DermicaPro',
        buttonText: form.interactiveButtonText,
        sections: form.interactiveSections,
      },
    }
    if (editingId != null) {
      const { template_type: _templateType, ...updatePayload } = payload
      update({ id: editingId, ...updatePayload }, {
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
  const totalInteractiveRows = form.interactiveSections.reduce((total, section) => total + section.rows.length, 0)
  const maxInteractiveButtons = form.interactiveButtons.some(button => button.type === 'reply') ? 3 : 2

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

        {capabilities && (
          <div className={`mb-4 flex gap-2 rounded-xl border px-4 py-3 text-xs ${capabilities.official_sending_supported ? 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'}`}>
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
          <form onSubmit={handleSubmit} className="mb-6 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 text-gray-900 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              {editingId != null ? 'Editar plantilla' : 'Nueva plantilla'}
            </h2>
            <div className="grid gap-2 md:grid-cols-2">
              <button
                type="button"
                disabled={editingId != null}
                onClick={() => setForm(f => ({ ...f, templateType: 'internal' }))}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed ${form.templateType === 'internal' ? 'border-green-500 bg-green-50 dark:bg-green-950/30' : 'border-gray-200 dark:border-gray-700'}`}
              >
                <MessageSquareText className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                <span><span className="block text-sm font-semibold">Plantilla interna</span><span className="block text-xs text-gray-500 dark:text-gray-400">Respuesta rápida; requiere ventana abierta.</span></span>
              </button>
              <button
                type="button"
                disabled={editingId != null}
                onClick={() => setForm(f => ({ ...f, templateType: 'official' }))}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed ${form.templateType === 'official' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-700'}`}
              >
                <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                <span><span className="block text-sm font-semibold">Plantilla oficial</span><span className="block text-xs text-gray-500 dark:text-gray-400">Aprobada por Meta; puede reabrir una conversación.</span></span>
              </button>
            </div>
            {form.templateType === 'internal' && (
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-gray-50 p-1.5 dark:bg-gray-900/50">
                {([
                  ['none', MessageSquareText, 'Texto'],
                  ['buttons', MousePointerClick, 'Botones'],
                  ['list', ListIcon, 'Lista'],
                ] as const).map(([value, Icon, label]) => (
                  <button key={value} type="button" onClick={() => { setForm(f => ({ ...f, interactiveType: value })); if (value !== 'none') setPendingAttachments([]) }} className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold ${form.interactiveType === value ? 'bg-white text-green-700 shadow-sm dark:bg-gray-700 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}><Icon className="h-3.5 w-3.5" />{label}</button>
                ))}
              </div>
            )}
            {form.templateType === 'official' && (
              <div className="grid gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/20 md:grid-cols-2">
                <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">Nombre exacto en Meta
                  <input required maxLength={512} pattern="[a-z0-9_]+" value={form.officialName} onChange={event => setForm(f => ({ ...f, officialName: event.target.value.toLowerCase() }))} placeholder="seguimiento_cliente" className="rounded-md border border-blue-200 bg-white px-3 py-2 text-sm dark:border-blue-900 dark:bg-gray-900" />
                </label>
                <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">Idioma
                  <input required maxLength={6} pattern="[a-z]{2,3}(_[A-Z]{2})?" value={form.officialLanguage} onChange={event => setForm(f => ({ ...f, officialLanguage: event.target.value }))} placeholder="es" className="rounded-md border border-blue-200 bg-white px-3 py-2 text-sm dark:border-blue-900 dark:bg-gray-900" />
                </label>
                <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">Categoría oficial
                  <select value={form.officialCategory} onChange={event => setForm(f => ({ ...f, officialCategory: event.target.value as NonNullable<MessageTemplate['official_category']> }))} className="rounded-md border border-blue-200 bg-white px-3 py-2 text-sm dark:border-blue-900 dark:bg-gray-900"><option value="UTILITY">Utility</option><option value="MARKETING">Marketing</option><option value="AUTHENTICATION">Authentication</option></select>
                </label>
                <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">Estado en Meta
                  <select value={form.officialStatus} onChange={event => setForm(f => ({ ...f, officialStatus: event.target.value as NonNullable<MessageTemplate['official_status']> }))} className="rounded-md border border-blue-200 bg-white px-3 py-2 text-sm dark:border-blue-900 dark:bg-gray-900"><option value="PENDING">Pendiente</option><option value="APPROVED">Aprobada</option><option value="REJECTED">Rechazada</option><option value="PAUSED">Pausada</option><option value="DISABLED">Deshabilitada</option></select>
                </label>
                <p className="text-[11px] text-blue-700 dark:text-blue-300 md:col-span-2">Estos datos deben coincidir exactamente con la plantilla existente en Meta. La aprobación directa se incorporará en la integración posterior con Meta.</p>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <input
                required
                maxLength={120}
                placeholder="Nombre"
                value={form.name}
                onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              />
              <input
                maxLength={50}
                pattern="[a-zA-Z0-9_-]*"
                placeholder="Atajo, ej. cotizacion"
                value={form.shortcut}
                onChange={(event) => setForm((f) => ({ ...f, shortcut: event.target.value }))}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              />
            </div>
            <textarea
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
              className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <input
                required
                maxLength={60}
                placeholder="Categoría"
                value={form.category}
                onChange={(event) => setForm((f) => ({ ...f, category: event.target.value }))}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              />
              <select
                value={form.stage}
                onChange={(event) => { const value = event.target.value; setForm((f) => ({ ...f, stage: value === '' || isLeadStage(value) ? value : f.stage })) }}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                <option value="">Cualquier etapa</option>
                {LEAD_STAGES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select
                value={form.taskType}
                onChange={(event) => { const value = event.target.value; setForm((f) => ({ ...f, taskType: value === '' || isTaskType(value) ? value : f.taskType })) }}
                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                <option value="">Cualquier tarea</option>
                {TASK_TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </div>
            {form.templateType === 'official' ? (
              <div className="grid gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">El texto aprobado usa variables numéricas consecutivas: {'{{1}}'}, {'{{2}}'}, ... Configura qué dato enviará el CRM en cada posición.</p>
                {form.officialParameterValues.map((value, index) => (
                  <label key={index} className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300 sm:grid-cols-[80px_1fr] sm:items-center"><span>{`{{${index + 1}}}`}</span><input required value={value} onChange={event => setForm(f => ({ ...f, officialParameterValues: f.officialParameterValues.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} placeholder="Ej. {{nombre}}" className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" /></label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Variables: {'{{nombre}}'}, {'{{telefono}}'}, {'{{servicio}}'}, {'{{vendedor}}'}, {'{{fecha_actual}}'}
              </p>
            )}
            {form.templateType === 'internal' && form.interactiveType !== 'none' && (
              <div className="grid gap-3 rounded-xl border border-green-200 bg-green-50/50 p-3 dark:border-green-900 dark:bg-green-950/20">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">Título interactivo
                    <input required maxLength={60} value={form.interactiveTitle} onChange={event => setForm(f => ({ ...f, interactiveTitle: event.target.value }))} placeholder="Elige una opción" className="rounded-md border border-green-200 bg-white px-3 py-2 text-sm dark:border-green-900 dark:bg-gray-900" />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">Pie de mensaje
                    <input maxLength={60} value={form.interactiveFooter} onChange={event => setForm(f => ({ ...f, interactiveFooter: event.target.value }))} placeholder="DermicaPro" className="rounded-md border border-green-200 bg-white px-3 py-2 text-sm dark:border-green-900 dark:bg-gray-900" />
                  </label>
                </div>
                {form.interactiveType === 'buttons' && (
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between"><p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Botones ({form.interactiveButtons.some(button => button.type === 'reply') ? 'máximo 3 respuestas' : 'máximo 2 CTA'})</p><button type="button" disabled={form.interactiveButtons.length >= maxInteractiveButtons} onClick={() => setForm(f => ({ ...f, interactiveButtons: [...f.interactiveButtons, { type: 'reply', displayText: '', id: `reply_${f.interactiveButtons.length + 1}` }] }))} className="flex items-center gap-1 text-xs font-medium text-green-700 disabled:opacity-40 dark:text-green-400"><Plus className="h-3 w-3" />Agregar</button></div>
                    {form.interactiveButtons.map((button, index) => {
                      const field = button.type === 'reply' ? 'id' : button.type === 'url' ? 'url' : button.type === 'call' ? 'phoneNumber' : 'copyCode'
                      return <div key={index} className="grid gap-2 rounded-lg border border-green-200 bg-white p-2 dark:border-green-900 dark:bg-gray-900 md:grid-cols-[120px_1fr_1fr_auto]">
                        <select value={button.type} onChange={event => setForm(f => ({ ...f, interactiveButtons: f.interactiveButtons.map((item, itemIndex) => itemIndex === index ? { type: event.target.value as TemplateInteractiveButton['type'], displayText: item.displayText } : item) }))} className="rounded border border-gray-200 px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"><option value="reply">Respuesta</option><option value="url">Abrir URL</option><option value="call">Llamar</option><option value="copy">Copiar código</option></select>
                        <input required maxLength={20} value={button.displayText} onChange={event => setForm(f => ({ ...f, interactiveButtons: f.interactiveButtons.map((item, itemIndex) => itemIndex === index ? { ...item, displayText: event.target.value } : item) }))} placeholder="Texto visible" className="rounded border border-gray-200 px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800" />
                        <input required type={field === 'url' ? 'url' : 'text'} inputMode={field === 'phoneNumber' ? 'tel' : 'text'} maxLength={field === 'url' ? 2048 : field === 'phoneNumber' ? 20 : 256} value={String(button[field] ?? '')} onChange={event => setForm(f => ({ ...f, interactiveButtons: f.interactiveButtons.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: event.target.value } : item) }))} placeholder={field === 'id' ? 'ID de respuesta' : field === 'url' ? 'https://...' : field === 'phoneNumber' ? '+519...' : 'Código'} className="rounded border border-gray-200 px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800" />
                        <button type="button" disabled={form.interactiveButtons.length === 1} onClick={() => setForm(f => ({ ...f, interactiveButtons: f.interactiveButtons.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded p-1 text-red-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    })}
                    <p className="text-[11px] text-gray-500">Los botones de respuesta no pueden mezclarse con URL, llamada o copia.</p>
                  </div>
                )}
                {form.interactiveType === 'list' && (
                  <div className="grid gap-2">
                    <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">Texto del botón que abre la lista
                      <input required maxLength={20} value={form.interactiveButtonText} onChange={event => setForm(f => ({ ...f, interactiveButtonText: event.target.value }))} placeholder="Ver opciones" className="rounded-md border border-green-200 bg-white px-3 py-2 text-sm dark:border-green-900 dark:bg-gray-900" />
                    </label>
                    <div className="flex items-center justify-between"><p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Secciones y opciones ({totalInteractiveRows}/10)</p><button type="button" disabled={form.interactiveSections.length >= 10 || totalInteractiveRows >= 10} onClick={() => setForm(f => ({ ...f, interactiveSections: [...f.interactiveSections, { title: `Sección ${f.interactiveSections.length + 1}`, rows: [{ title: '', description: '', rowId: `option_${f.interactiveSections.length + 1}_1` }] }] }))} className="flex items-center gap-1 text-xs font-medium text-green-700 disabled:opacity-40 dark:text-green-400"><Plus className="h-3 w-3" />Sección</button></div>
                    {form.interactiveSections.map((section, sectionIndex) => (
                      <div key={sectionIndex} className="grid gap-2 rounded-lg border border-green-200 bg-white p-3 dark:border-green-900 dark:bg-gray-900">
                        <div className="flex gap-2"><input required maxLength={24} value={section.title} onChange={event => setForm(f => ({ ...f, interactiveSections: f.interactiveSections.map((item, index) => index === sectionIndex ? { ...item, title: event.target.value } : item) }))} placeholder="Título de sección" className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800" /><button type="button" disabled={form.interactiveSections.length === 1} onClick={() => setForm(f => ({ ...f, interactiveSections: f.interactiveSections.filter((_, index) => index !== sectionIndex) }))} className="rounded p-1 text-red-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>
                        {section.rows.map((row, rowIndex) => <div key={rowIndex} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]"><input required maxLength={24} value={row.title} onChange={event => setForm(f => ({ ...f, interactiveSections: f.interactiveSections.map((item, index) => index === sectionIndex ? { ...item, rows: item.rows.map((option, optionIndex) => optionIndex === rowIndex ? { ...option, title: event.target.value } : option) } : item) }))} placeholder="Opción" className="rounded border border-gray-200 px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800" /><input required value={row.description} maxLength={72} onChange={event => setForm(f => ({ ...f, interactiveSections: f.interactiveSections.map((item, index) => index === sectionIndex ? { ...item, rows: item.rows.map((option, optionIndex) => optionIndex === rowIndex ? { ...option, description: event.target.value } : option) } : item) }))} placeholder="Descripción obligatoria" className="rounded border border-gray-200 px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800" /><input required maxLength={200} value={row.rowId} onChange={event => setForm(f => ({ ...f, interactiveSections: f.interactiveSections.map((item, index) => index === sectionIndex ? { ...item, rows: item.rows.map((option, optionIndex) => optionIndex === rowIndex ? { ...option, rowId: event.target.value } : option) } : item) }))} placeholder="ID único" className="rounded border border-gray-200 px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800" /><button type="button" disabled={section.rows.length === 1} onClick={() => setForm(f => ({ ...f, interactiveSections: f.interactiveSections.map((item, index) => index === sectionIndex ? { ...item, rows: item.rows.filter((_, optionIndex) => optionIndex !== rowIndex) } : item) }))} className="rounded p-1 text-red-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>)}
                        <button type="button" disabled={totalInteractiveRows >= 10} onClick={() => setForm(f => ({ ...f, interactiveSections: f.interactiveSections.map((item, index) => index === sectionIndex ? { ...item, rows: [...item.rows, { title: '', description: '', rowId: `option_${sectionIndex + 1}_${item.rows.length + 1}` }] } : item) }))} className="flex items-center gap-1 text-xs font-medium text-green-700 disabled:opacity-40 dark:text-green-400"><Plus className="h-3 w-3" />Agregar opción</button>
                      </div>
                    ))}
                    <p className="text-[11px] text-gray-500">Máximo 10 opciones en total. Los IDs no son visibles para el cliente.</p>
                  </div>
                )}
              </div>
            )}
            {form.templateType === 'internal' && form.interactiveType === 'none' && <div
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
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 py-2 text-center text-sm font-medium text-gray-600 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400">
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
                    <div key={attachment.id} className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-violet-500 dark:text-violet-400" />
                        <span className="truncate" title={attachment.filename}>{attachment.filename}</span>
                        <span className="hidden shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] uppercase text-gray-600 dark:bg-gray-700 dark:text-gray-300 sm:inline">
                          {attachment.content_type.split('/')[0] || 'archivo'}
                        </span>
                      </span>
                      <button type="button" onClick={() => deleteAttachment.mutate(attachment.id)} title="Quitar adjunto" className="shrink-0 rounded p-1 text-red-500 hover:bg-red-100 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/50 dark:hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                  {pendingAttachments.map(attachment => {
                    const filename = attachment.source === 'upload' ? attachment.file.name : attachment.asset.filename
                    const contentType = attachment.source === 'upload' ? attachment.file.type : attachment.asset.content_type
                    return (
                      <div key={attachment.key} className="flex items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">
                        <span className="flex min-w-0 items-center gap-2">
                          {attachment.source === 'library' && <FolderOpen className="h-3.5 w-3.5 shrink-0" />}
                          {attachment.source === 'upload' && <FileText className="h-4 w-4 shrink-0" />}
                          <span className="truncate" title={filename}>{filename}</span>
                          <span className="hidden shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] uppercase text-green-700 dark:bg-green-900/60 dark:text-green-300 sm:inline">
                            {contentType.split('/')[0] || 'archivo'}
                          </span>
                        </span>
                        <button type="button" onClick={() => setPendingAttachments(items => items.filter(item => item.key !== attachment.key))} title="Quitar adjunto" className="shrink-0 rounded p-1 text-red-500 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950/50"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    )
                  })}
                </div>
              )}
              <p className="mt-2 text-[11px] text-gray-400">Máximo 25 MB por archivo. Se enviarán en el orden agregado.</p>
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
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${template.template_type === 'official' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>{template.template_type === 'official' ? 'Oficial' : 'Interna'}</span>
                      {template.interactive_type !== 'none' && <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-green-700 dark:bg-green-950 dark:text-green-300">{template.interactive_type === 'buttons' ? 'Botones' : 'Lista'}</span>}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {template.category}
                      {template.shortcut ? ` · /${template.shortcut}` : ''}
                      {template.visibility === 'personal' ? ' · Personal' : ' · Equipo'}
                      {template.use_count > 0 ? ` · Usada ${template.use_count}x` : ''}
                    </p>
                    {template.template_type === 'official' && <p className="mt-1 text-[11px] text-blue-600 dark:text-blue-400">{template.official_name} · {template.official_language} · {template.official_category} · <span className="font-semibold">{template.official_status}</span></p>}
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
