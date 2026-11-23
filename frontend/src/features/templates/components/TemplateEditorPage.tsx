import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { Spinner } from '../../../shared/ui/Spinner'
import { cn } from '../../../shared/utils/cn'
import { stateLine, submitLabel } from '../domain/editorLabels'
import { fieldId } from '../domain/fieldLimits'
import { preSendChecks } from '../domain/preSendChecks'
import type { TemplateField } from '../domain/templateForm'
import { officialStatus } from '../domain/templateList'
import { useTemplateEditor, type SaveOutcome, type TemplateEditorState } from '../hooks/useTemplateEditor'
import { useTemplateEditorData, type TemplateEditorData } from '../hooks/useTemplateEditorData'
import type { MessageTemplate, TemplateInteractiveType } from '../types'
import { EditorHeader, type EditorTab } from './editor/EditorHeader'
import { EditorNotices } from './editor/EditorNotices'
import { InternalMessageSection } from './editor/InternalMessageSection'
import { OfficialMessageSection } from './editor/OfficialMessageSection'
import { OrganizationSection } from './editor/OrganizationSection'
import { Notice } from './editor/parts'
import { PreSendChecklist } from './editor/PreSendChecklist'
import { TemplateDetailsSection } from './editor/TemplateDetailsSection'
import { TemplatePreview } from './editor/TemplatePreview'
import { TemplateTypeSection } from './editor/TemplateTypeSection'

const LIST_PATH = '/templates'
const FORM_ID = 'template-editor-form'

type ReadyData = Extract<TemplateEditorData, { status: 'ready' }>

function focusField(field: TemplateField) {
  // Dos cuadros: el campo puede recién aparecer con el error (el nombre en
  // Meta está plegado hasta que hace falta).
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const element = document.getElementById(fieldId(field))
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    element?.focus({ preventScroll: true })
  }))
}

function announceSaved(outcome: SaveOutcome) {
  if (outcome === 'sent_to_review') {
    toast.success('Enviada a revisión de Meta', { description: 'Queda «En revisión» en la lista hasta que Meta responda.' })
  } else {
    toast.success('Plantilla guardada')
  }
}

const editorTitle = (template: MessageTemplate | undefined) => (template ? `Editar «${template.name}»` : 'Nueva plantilla')

const statusOf = (template: MessageTemplate | undefined) =>
  template?.template_type === 'official' ? officialStatus(template.official_status) : null

/** La columna de la vista previa: el mensaje y, en una oficial, lo que
 *  conviene revisar antes de enviarla a Meta. */
function EditorAside({ editor, data, hidden }: { editor: TemplateEditorState; data: ReadyData; hidden: boolean }) {
  const { form } = editor
  const official = form.templateType === 'official'
  const others = data.templates.filter(other => other.template_type === 'official' && other.id !== data.template?.id).map(other => other.content)
  return (
    <aside className={cn('flex min-w-0 flex-col gap-3 lg:sticky lg:top-6', hidden && 'hidden lg:flex')}>
      <TemplatePreview form={form} attachments={editor.attachments} mediaAssets={data.mediaAssets} defaultFooter={data.capabilities?.interactive_default_footer} />
      {official && <PreSendChecklist checks={preSendChecks(form, others)} />}
      {editor.sendsToReview && (
        <Notice tone="info">
          <p className="font-semibold">Qué pasa al enviarla a revisión</p>
          <p>Meta suele responder en minutos y puede tardar hasta 48 horas. Mientras tanto queda «En revisión» y no se puede enviar a clientes. La lista se actualiza sola cuando Meta responde.</p>
        </Notice>
      )}
    </aside>
  )
}

function TemplateEditor({ data }: { data: ReadyData }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<EditorTab>('edit')
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const [pendingFormat, setPendingFormat] = useState<TemplateInteractiveType | null>(null)
  const { template, capabilities } = data
  const limits = capabilities?.interactive_limits

  function showField(field: TemplateField) {
    setTab('edit')
    focusField(field)
  }

  const editor = useTemplateEditor({
    template,
    seed: data.seed,
    categories: data.categories,
    limits,
    onSaved: (saved, outcome) => {
      announceSaved(outcome)
      navigate(LIST_PATH, { state: { highlightId: saved.id } })
    },
    onAttachmentsFailed: (saved, message) => {
      toast.error('La plantilla se guardó, pero un archivo no se pudo subir', { description: message })
      navigate(`${LIST_PATH}/${saved.id}`, { replace: true, state: { reload: Date.now() } })
    },
    onInvalid: showField,
  })
  const { form, change, saving } = editor
  const official = form.templateType === 'official'
  const existing = template !== undefined
  const label = submitLabel({ existing, official, sendsToReview: editor.sendsToReview })
  const state = stateLine({ saving, backedUp: editor.backedUp, dirty: editor.dirty, existing, status: statusOf(template) })
  const fileCount = editor.attachments.length

  function leave() {
    if (editor.dirty) setConfirmingLeave(true)
    else navigate(LIST_PATH)
  }

  function changeFormat(format: TemplateInteractiveType) {
    if (format === form.interactiveType) return
    // Botones y listas no llevan archivos: se pregunta antes de quitarlos.
    if (format !== 'none' && fileCount > 0) setPendingFormat(format)
    else change({ interactiveType: format })
  }

  function confirmFormat() {
    if (pendingFormat) {
      editor.setAttachments([])
      change({ interactiveType: pendingFormat })
    }
    setPendingFormat(null)
  }

  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      <EditorHeader
        listPath={LIST_PATH}
        formId={FORM_ID}
        title={editorTitle(template)}
        subtitle={`${official ? 'Oficial de Meta' : 'Interna'} · ${state}`}
        submitLabel={label}
        saving={saving}
        pendingCount={editor.pendingIssues.length}
        serverError={editor.serverError}
        tab={tab}
        onTab={setTab}
        onLeave={leave}
        onShowPending={() => showField(editor.pendingIssues[0].field)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1200px] items-start gap-6 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:px-8 lg:py-6">
          <form
            id={FORM_ID}
            noValidate
            onSubmit={event => { event.preventDefault(); void editor.submit() }}
            className={cn('flex min-w-0 flex-col gap-4', tab === 'preview' && 'hidden lg:flex')}
          >
            <EditorNotices editor={editor} template={template} status={statusOf(template)} capabilities={capabilities} />
            <TemplateTypeSection type={form.templateType} locked={existing} onChange={templateType => change({ templateType })} />
            <TemplateDetailsSection editor={editor} />
            {official
              ? <OfficialMessageSection editor={editor} limits={limits} mediaAssets={data.mediaAssets} />
              : <InternalMessageSection editor={editor} limits={limits} defaultFooter={capabilities?.interactive_default_footer} onFormatChange={changeFormat} />}
            <OrganizationSection editor={editor} categories={data.categories} />
          </form>
          <EditorAside editor={editor} data={data} hidden={tab === 'edit'} />
        </div>
      </div>

      <footer className="flex shrink-0 gap-2 border-t border-line bg-surface px-4 py-3 lg:hidden">
        <Button variant="secondary" size="lg" onClick={leave} disabled={saving}>Cancelar</Button>
        <Button type="submit" form={FORM_ID} size="lg" className="min-w-0 flex-1" loading={saving}>{label}</Button>
      </footer>

      <ConfirmDialog
        open={confirmingLeave}
        onOpenChange={setConfirmingLeave}
        title="¿Descartar los cambios?"
        description={`Se perderá lo que cambiaste en ${form.name.trim() ? `«${form.name.trim()}»` : 'esta plantilla'}.`}
        cancelLabel="Seguir editando"
        confirmLabel="Descartar"
        onConfirm={() => { editor.discardChanges(); navigate(LIST_PATH) }}
      />
      <ConfirmDialog
        open={pendingFormat != null}
        onOpenChange={open => { if (!open) setPendingFormat(null) }}
        title="Los botones y las listas no admiten archivos"
        description={`Si cambias de formato se ${fileCount === 1 ? 'quita el archivo' : `quitan los ${fileCount} archivos`} de esta plantilla. Lo que esté en tu biblioteca sigue ahí.`}
        cancelLabel="Dejar como está"
        confirmLabel="Cambiar de formato"
        confirmVariant="primary"
        onConfirm={confirmFormat}
      />
    </div>
  )
}

/**
 * El editor de plantillas en pantalla propia: `/templates/nueva` y
 * `/templates/:id` (2026-11-23).
 *
 * Antes era un formulario de hasta 2000 px incrustado entre los indicadores
 * y la lista: «Nueva plantilla» lo abría fuera de la vista, los errores
 * salían arriba mientras «Guardar» quedaba abajo, y editar otra plantilla
 * pisaba lo escrito. Acá el formulario sigue el orden del mensaje, la vista
 * previa acompaña a la derecha (o en su pestaña, en el celular) y guardar
 * está siempre a la vista.
 */
export function TemplateEditorPage() {
  const { templateId } = useParams()
  const location = useLocation()
  const state = location.state as { reload?: number; copyOf?: number } | null
  const data = useTemplateEditorData({
    templateId: templateId === undefined ? null : Number(templateId),
    copyOf: state?.copyOf,
    reload: state?.reload,
  })

  if (data.status === 'loading') {
    return <div className="flex h-full items-center justify-center bg-canvas"><Spinner /></div>
  }
  if (data.status === 'missing') {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <EmptyState
          title="No encontramos esta plantilla"
          description="Puede que alguien la haya eliminado."
          action={<Button asChild variant="secondary"><Link to={LIST_PATH}>Volver a Plantillas</Link></Button>}
        />
      </div>
    )
  }
  return <TemplateEditor key={data.key} data={data} />
}
