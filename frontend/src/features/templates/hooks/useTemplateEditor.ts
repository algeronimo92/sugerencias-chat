import { useEffect, useMemo, useRef, useState } from 'react'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { attachmentsChanged, draftFromSaved, type DraftAttachment } from '../domain/attachmentDraft'
import { metaEditBlock, metaEditRules } from '../domain/metaEditRules'
import { resizeParameters } from '../domain/officialVariables'
import { emptyTemplateForm, formFromTemplate, officialNameFrom, payloadFromForm, sameForm } from '../domain/templateDraft'
import { clearTemplateDraft, loadTemplateDraft, saveTemplateDraft } from '../domain/templateDraftStorage'
import { templateFormIssues, type TemplateField, type TemplateFormState } from '../domain/templateForm'
import type { InteractiveLimits, MessageTemplate, TemplateCategory } from '../types'
import { useApplyAttachmentDraft } from './useApplyAttachmentDraft'
import { useCreateTemplate, useUpdateTemplate } from './useTemplates'

export type SaveOutcome = 'saved' | 'sent_to_review'

type FormPatch = Partial<TemplateFormState> | ((form: TemplateFormState) => Partial<TemplateFormState>)

interface Options {
  /** La plantilla que se edita; sin ella se crea una nueva. */
  template: MessageTemplate | undefined
  /** Punto de partida de una plantilla nueva: la copia de otra. */
  seed?: TemplateFormState
  categories: TemplateCategory[]
  limits: InteractiveLimits | undefined
  onSaved: (template: MessageTemplate, outcome: SaveOutcome) => void
  /** La plantilla quedó guardada pero algún archivo no. */
  onAttachmentsFailed: (template: MessageTemplate, message: string) => void
  /** Hay campos por corregir: el primero, para llevar la vista hasta él. */
  onInvalid: (field: TemplateField) => void
}

/** El mensaje tal como lo revisa Meta: si cambia en una plantilla ya enviada,
 *  vuelve a revisión. */
function reviewedByMeta(form: TemplateFormState) {
  return JSON.stringify([
    form.content.trim(), form.officialParameterValues, form.officialHeaderType,
    form.officialHeaderText.trim(), form.officialHeaderMediaAssetId, form.officialFooter.trim(), form.officialButtons,
  ])
}

/**
 * El estado del editor de plantillas: el formulario, sus errores por campo,
 * el borrador de archivos, el respaldo local y el guardado.
 */
export function useTemplateEditor({ template, seed, categories, limits, onSaved, onAttachmentsFailed, onInvalid }: Options) {
  const templateId = template?.id ?? null
  const metaLocked = template?.meta_template_id != null
  const savedAttachments = useMemo(() => template?.attachments ?? [], [template])

  const [initial] = useState(() => (template ? formFromTemplate(template) : emptyTemplateForm(categories)))
  // Una copia arranca de la plantilla copiada, no del borrador que hubiera.
  const [stored] = useState(() => (seed ? null : loadTemplateDraft(templateId)))
  const [form, setForm] = useState<TemplateFormState>(() => stored?.form ?? seed ?? initial)
  // Una plantilla nueva toma su nombre de Meta del nombre visible hasta que
  // alguien lo escribe a mano; una que ya existe conserva el suyo.
  const [officialNameEdited, setOfficialNameEdited] = useState(() => stored?.officialNameEdited ?? Boolean(template?.official_name))
  const [restoredAt, setRestoredAt] = useState<number | null>(() => stored?.savedAt ?? null)
  const [attachments, setAttachments] = useState<DraftAttachment[]>(() => draftFromSaved(savedAttachments))
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [backedUp, setBackedUp] = useState(false)
  // Ya guardada: el respaldo local se borró y no tiene que volver a escribirse.
  const finished = useRef(false)

  const createTemplate = useCreateTemplate()
  const updateTemplate = useUpdateTemplate()
  const applyAttachments = useApplyAttachmentDraft()

  const issues = useMemo(() => templateFormIssues(form, limits), [form, limits])
  const formChanged = !sameForm(form, initial)
  const carriesAttachments = form.templateType === 'internal' && form.interactiveType === 'none'
  const filesChanged = attachmentsChanged(savedAttachments, attachments)
  const dirty = formChanged || filesChanged
  const metaRules = useMemo(() => metaEditRules(template), [template])
  const metaChanges = {
    content: reviewedByMeta(form) !== reviewedByMeta(initial),
    category: form.officialCategory !== initial.officialCategory,
  }
  // El backend reenvía a Meta si cambió el mensaje y siempre que se guarda
  // una rechazada; un cambio de categoría solo actualiza la categoría.
  const goesBackToReview = metaLocked && form.templateType === 'official'
    && (metaChanges.content || template?.official_status === 'REJECTED')
  // Al guardar, Meta la revisa: es una oficial nueva, o cambió lo que Meta mira.
  const sendsToReview = form.templateType === 'official' && (!template || goesBackToReview)

  useEffect(() => {
    if (finished.current) return
    if (!formChanged) {
      clearTemplateDraft(templateId)
      return
    }
    const timer = window.setTimeout(() => {
      setBackedUp(saveTemplateDraft(templateId, { form, officialNameEdited, savedAt: Date.now() }))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [form, officialNameEdited, formChanged, templateId])

  function change(patch: FormPatch) {
    setForm(current => {
      const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) }
      if (next.templateType === 'official') {
        if (next.content !== current.content || current.templateType !== 'official') {
          next.officialParameterValues = resizeParameters(next.content, next.officialParameterValues)
        }
        if (!officialNameEdited && !metaLocked) next.officialName = officialNameFrom(next.name)
      }
      return next
    })
    setServerError(null)
  }

  function setOfficialName(value: string) {
    setOfficialNameEdited(true)
    setForm(current => ({ ...current, officialName: value.toLowerCase() }))
  }

  /** El nombre de Meta vuelve a seguir al nombre visible. */
  function followName() {
    setOfficialNameEdited(false)
    setForm(current => ({ ...current, officialName: officialNameFrom(current.name) }))
  }

  function discardChanges() {
    clearTemplateDraft(templateId)
    setForm(initial)
    setOfficialNameEdited(Boolean(template?.official_name))
    setAttachments(draftFromSaved(savedAttachments))
    setRestoredAt(null)
    setSubmitted(false)
    setServerError(null)
    setBackedUp(false)
  }

  /** Guarda el formulario. `null` si el backend lo rechazó (el error ya quedó
   *  a la vista). */
  async function saveForm(): Promise<MessageTemplate | null> {
    const { template_type: templateType, service, ...changes } = payloadFromForm(form)
    try {
      // Botones y listas no admiten archivos: si quedaban de antes, se quitan
      // primero para que el backend acepte el cambio de formato.
      if (template && !carriesAttachments && savedAttachments.length > 0) {
        await applyAttachments.apply(template.id, savedAttachments, [])
      }
      return template
        ? await updateTemplate.mutateAsync({ id: template.id, ...changes })
        : await createTemplate.mutateAsync({ ...changes, template_type: templateType, service })
    } catch (reason) {
      setServerError(extractErrorMessage(reason))
      return null
    }
  }

  /** Sube, quita y ordena los archivos de una plantilla ya guardada. Devuelve
   *  el motivo si algo falló. */
  async function saveAttachments(saved: MessageTemplate): Promise<string | null> {
    if (!carriesAttachments || !filesChanged) return null
    try {
      await applyAttachments.apply(saved.id, savedAttachments, attachments)
      return null
    } catch (reason) {
      return extractErrorMessage(reason)
    }
  }

  async function submit() {
    if (saving) return
    setSubmitted(true)
    if (issues.length) {
      onInvalid(issues[0].field)
      return
    }
    const blocked = metaLocked ? metaEditBlock(metaRules, metaChanges) : null
    if (blocked) {
      setServerError(blocked)
      return
    }
    setSaving(true)
    setServerError(null)
    // En `finally`: pase lo que pase al guardar, el botón no puede quedar
    // girando ni deshabilitado.
    try {
      const saved = await saveForm()
      if (!saved) return
      finished.current = true
      clearTemplateDraft(templateId)
      const attachmentsError = await saveAttachments(saved)
      if (attachmentsError) {
        // El texto ya quedó guardado. Quedarse acá en modo «crear» haría que
        // el siguiente clic en Guardar creara un duplicado: se sigue desde la
        // plantilla guardada, con lo que sí llegó a subirse.
        onAttachmentsFailed(saved, attachmentsError)
        return
      }
      onSaved(saved, sendsToReview ? 'sent_to_review' : 'saved')
    } finally {
      setSaving(false)
    }
  }

  const errorsFor = (field: TemplateField): string[] =>
    submitted ? issues.filter(issue => issue.field === field).map(issue => issue.message) : []

  return {
    form,
    change,
    setOfficialName,
    followName,
    officialNameEdited,
    metaLocked,
    metaRules,
    attachments,
    setAttachments,
    carriesAttachments,
    errorsFor,
    pendingIssues: submitted ? issues : [],
    serverError,
    setServerError,
    saving: saving || applyAttachments.pending,
    dirty,
    backedUp: backedUp && formChanged,
    restoredAt,
    dismissRestored: () => setRestoredAt(null),
    discardChanges,
    goesBackToReview,
    sendsToReview,
    submit,
  }
}

export type TemplateEditorState = ReturnType<typeof useTemplateEditor>
