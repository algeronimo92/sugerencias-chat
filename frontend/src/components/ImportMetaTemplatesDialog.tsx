import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, BadgeCheck, Download, Loader2, X } from 'lucide-react'
import type { TemplateCategory } from '../types'
import { useImportMetaTemplate, useMetaTemplateDetail, useMetaTemplates } from '../hooks/useTemplates'
import { templateParameterIdentifiers } from '../utils/templates'
import { extractErrorMessage } from '../utils/errors'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'
import { Select } from './ui/Input'
import './templates-page.css'

interface Props {
  existingMetaIds: Set<string>
  categories: TemplateCategory[]
  defaultCategory?: string
  onClose: () => void
}

const STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  REJECTED: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
}

/** Espejo de los tipos que `_parse_meta_template` reconoce en el backend
 * (`routers/templates.py`). Un botón fuera de esta lista (ej. `VOICE_CALL`,
 * "Llamame por WhatsApp") se descartaba en silencio al importar: la
 * plantilla quedaba con `official_buttons` vacío acá, pero Meta sigue
 * exigiendo lo que aprobó -- un botón de llamada requiere tener la Calling
 * API habilitada para el número, y sin ese aviso el primer indicio del
 * problema era un 132000/138000 recién al intentar enviarla. */
const SUPPORTED_BUTTON_TYPES = new Set(['QUICK_REPLY', 'URL', 'PHONE_NUMBER'])

const UNSUPPORTED_BUTTON_LABELS: Record<string, string> = {
  VOICE_CALL: 'llamada de voz (requiere habilitar Calling API para este número en WhatsApp Manager)',
}

export function ImportMetaTemplatesDialog({ existingMetaIds, categories, defaultCategory, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState(defaultCategory ?? categories[0]?.name ?? '')
  const [shortcut, setShortcut] = useState('')
  const [parameterValues, setParameterValues] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const { data: remoteTemplates = [], isLoading, isError } = useMetaTemplates(true)
  const { data: detail, isLoading: isLoadingDetail } = useMetaTemplateDetail(selectedId)
  const importTemplate = useImportMetaTemplate()

  const pendingTemplates = remoteTemplates.filter(item => !existingMetaIds.has(item.id))

  function pickTemplate(id: string, remoteName: string) {
    setSelectedId(id)
    setName(remoteName)
    setShortcut('')
    setParameterValues([])
    setError(null)
  }

  function backToList() {
    setSelectedId(null)
    setError(null)
  }

  const bodyText = detail?.components?.find(c => c.type === 'BODY')?.text ?? ''
  const variableNames = detail ? templateParameterIdentifiers(bodyText) : []
  const variableCount = variableNames.length
  const unsupportedButtons = (detail?.components?.find(c => c.type === 'BUTTONS')?.buttons ?? [])
    .filter(button => !SUPPORTED_BUTTON_TYPES.has(button.type))

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (selectedId == null) return
    setError(null)
    const trimmedName = name.trim()
    if (!trimmedName) { setError('El nombre es obligatorio.'); return }
    if (!category) { setError('Selecciona una categoría.'); return }
    const values = parameterValues.slice(0, variableCount).map(value => value.trim())
    if (values.length !== variableCount || values.some(value => !value)) {
      setError(`Completa el valor por defecto de las ${variableCount} variable${variableCount === 1 ? '' : 's'} del mensaje.`)
      return
    }
    importTemplate.mutate(
      { metaTemplateId: selectedId, name: trimmedName, category, shortcut: shortcut.trim() || null, officialParameterValues: values },
      {
        onSuccess: () => { toast.success(`${trimmedName} fue importada desde Meta`); onClose() },
        onError: err => setError(extractErrorMessage(err)),
      },
    )
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content className={`${dialogContentPositionClass} flex max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl flex-col overflow-hidden rounded-3xl border border-wa-border bg-white shadow-2xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}>
          <div className="flex items-center justify-between gap-3 border-b border-wa-border bg-[#f7faf9] px-5 py-5 dark:border-wa-border-dark dark:bg-wa-head-dark sm:px-6">
            <div className="flex items-center gap-2">
              {selectedId != null && (
                <button type="button" onClick={backToList} className="rounded-md p-1 text-wa-muted hover:bg-wa-field dark:hover:bg-wa-head-dark">
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary"><Download className="h-5 w-5" /></span>
              <div>
                <Dialog.Title className="text-lg font-bold text-wa-text dark:text-white">Importar desde Meta</Dialog.Title>
                <p className="text-xs text-wa-muted">Plantillas ya creadas en el WhatsApp Manager que aún no están vinculadas a la app</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1.5 text-wa-muted hover:bg-wa-field dark:hover:bg-wa-head-dark"><X className="h-5 w-5" /></button>
          </div>

          <div className="overflow-y-auto p-5 sm:p-6">
            {selectedId == null ? (
              isLoading ? (
                <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-wa-muted" /></div>
              ) : isError ? (
                <p className="flex items-center gap-2 py-16 text-center text-sm text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> No se pudo consultar Meta. Revisa la configuración de Meta Cloud API.
                </p>
              ) : pendingTemplates.length === 0 ? (
                <p className="py-16 text-center text-sm text-wa-muted">No hay plantillas nuevas en Meta: todas ya están vinculadas a la app.</p>
              ) : (
                <div className="grid gap-3">
                  <div><h3 className="text-sm font-bold text-wa-text dark:text-white">Disponibles para importar</h3><p className="mt-1 text-xs text-wa-muted">Selecciona una plantilla para revisar su contenido y configurar sus variables.</p></div>
                  {pendingTemplates.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => pickTemplate(item.id, item.name)}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-wa-border bg-[#f9fbfa] p-4 text-left transition hover:border-wa-primary hover:bg-green-50/50 dark:border-wa-border-dark dark:bg-wa-head-dark dark:hover:bg-wa-active-dark"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-wa-text dark:text-white">{item.name}</p>
                        <p className="text-xs text-wa-muted dark:text-wa-muted-dark">{item.language} · {item.category}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${STATUS_STYLES[item.status] ?? 'bg-wa-field text-gray-600 dark:bg-wa-active-dark dark:text-gray-300'}`}>{item.status}</span>
                    </button>
                  ))}
                </div>
              )
            ) : isLoadingDetail ? (
              <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-wa-muted" /></div>
            ) : (
              <form onSubmit={handleSubmit} className="templates-import-form grid gap-4">
                <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300">
                  <p className="flex items-center gap-1.5 font-semibold"><BadgeCheck className="h-3.5 w-3.5" /> {detail?.name} · {detail?.language} · {detail?.category}</p>
                  <p className="mt-1 whitespace-pre-line">{bodyText}</p>
                </div>
                <div><h3 className="text-sm font-bold text-wa-text dark:text-white">Datos en el CRM</h3><p className="mt-1 text-xs text-wa-muted">Así encontrarán y usarán esta plantilla los miembros del equipo.</p></div>
                {unsupportedButtons.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div>
                      <p className="font-semibold">Esta plantilla tiene un botón que la app no muestra ni gestiona:</p>
                      <ul className="mt-1 list-disc pl-4">
                        {unsupportedButtons.map((button, index) => (
                          <li key={index}>
                            "{button.text}" — {UNSUPPORTED_BUTTON_LABELS[button.type] ?? `tipo ${button.type}, no soportado`}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1">Se va a importar igual, pero como el botón sigue existiendo en la plantilla aprobada en Meta, el envío puede fallar hasta que resuelvas eso del lado de Meta.</p>
                    </div>
                  </div>
                )}
                {error && <div className="whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">{error}</div>}
                <label className="templates-field">Nombre en la app
                  <input required maxLength={120} value={name} onChange={event => setName(event.target.value)} className="rounded-md border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-field-dark" />
                </label>
                <label className="templates-field">Categoría
                  <Select value={category} onChange={event => setCategory(event.target.value)} className="rounded-md border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-field-dark">
                    {categories.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
                  </Select>
                </label>
                <label className="templates-field">Atajo (opcional)
                  <input maxLength={50} value={shortcut} onChange={event => setShortcut(event.target.value)} placeholder="ej. bienvenida" className="rounded-md border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-field-dark" />
                </label>
                {variableCount > 0 && (
                  <div className="grid gap-3 rounded-2xl border border-wa-border bg-[#f9fbfa] p-4 dark:border-wa-border-dark dark:bg-wa-head-dark">
                    <h3 className="text-sm font-bold text-wa-text dark:text-white">Variables del mensaje</h3>
                    <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
                      Valor por defecto de cada variable — podés usar texto fijo o un placeholder interno: {'{{nombre}}'}, {'{{telefono}}'}, {'{{servicio}}'}, {'{{vendedor}}'}, {'{{fecha_actual}}'}
                    </p>
                    {variableNames.map((variableName, index) => (
                      <label key={index} className="templates-field">{`{{${variableName}}}`}<input
                        required
                        value={parameterValues[index] ?? ''}
                        onChange={event => setParameterValues(current => {
                          const next = [...current]
                          next[index] = event.target.value
                          return next
                        })}
                        placeholder={`Valor de {{${variableName}}}`}
                        className="rounded-md border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-field-dark"
                      /></label>
                    ))}
                  </div>
                )}
                <div className="mt-1 flex flex-wrap justify-end gap-2 border-t border-wa-border pt-4 dark:border-wa-border-dark">
                  <button type="button" onClick={backToList} className="rounded-xl border border-wa-border px-4 py-2.5 text-sm font-semibold text-wa-muted hover:bg-wa-field dark:border-wa-border-dark dark:hover:bg-wa-head-dark">Volver</button>
                  <button type="submit" disabled={importTemplate.isPending} className="flex items-center gap-2 rounded-xl bg-wa-primary-strong px-4 py-2.5 text-sm font-semibold text-white hover:bg-wa-primary disabled:opacity-60">
                    {importTemplate.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Importar
                  </button>
                </div>
              </form>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
