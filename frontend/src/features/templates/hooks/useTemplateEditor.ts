import { useEffect, useMemo, useRef, useState } from 'react'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { attachmentsChanged, draftFromSaved, type DraftAttachment } from '../domain/attachmentDraft'
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

/** Lo que Meta vuelve a revisar si cambia en una plantilla ya enviada. */
function reviewedByMeta(form: TemplateFormState) {
  return JSON.stringify([
    form.content.trim(), form.officialParameterValues, form.officialCategory, form.officialHeaderType,
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
  const goesBackToReview = metaLocked && form.templateType === 'official' && reviewedByMeta(form) !== reviewedByMeta(initial)

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

  async function submit() {
    if (saving) return
    setSubmitted(true)
    if (issues.length) {
      onInvalid(issues[0].field)
      return
    }
    setSaving(true)
    setServerError(null)
    const { template_type: _templateType, service, ...changes } = payloadFromForm(form)
    let saved: MessageTemplate
    try {
      // Botones y listas no admiten archivos: si quedaban de antes, se quitan
      // primero para que el backend acepte el cambio de formato.
      if (template && !carriesAttachments && savedAttachments.length > 0) {
        await applyAttachments.apply(template.id, savedAttachments, [])
      }
      saved = template
        ? await updateTemplate.mutateAsync({ id: template.id, ...changes })
        : await createTemplate.mutateAsync({ ...changes, template_type: _templateType, service })
    } catch (reason) {
      setServerError(extractErrorMessage(reason))
      setSaving(false)
      return
    }

    finished.current = true
    clearTemplateDraft(templateId)
    try {
      if (carriesAttachments && filesChanged) await applyAttachments.apply(saved.id, savedAttachments, attachments)
    } catch (reason) {
      // El texto ya quedó guardado. Quedarse acá en modo «crear» haría que el
      // siguiente clic en Guardar creara un duplicado: se sigue desde la
      // plantilla guardada, con lo que sí llegó a subirse.
      setSaving(false)
      onAttachmentsFailed(saved, extractErrorMessage(reason))
      return
    }
    setSaving(false)
    const reviewed = form.templateType === 'official' && (!template || goesBackToReview)
    onSaved(saved, reviewed ? 'sent_to_review' : 'saved')
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
    submit,
  }
}

export type TemplateEditorState = ReturnType<typeof useTemplateEditor>
