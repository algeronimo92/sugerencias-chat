import { AlertCircle, ArrowLeft, Info, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { Spinner } from '../../../shared/ui/Spinner'
import { cn } from '../../../shared/utils/cn'
import { useMediaLibrary } from '../../media/public/queries'
import type { MediaAsset } from '../../media/types'
import { TEMPLATE_LIMITS, fieldId } from '../domain/fieldLimits'
import { preSendChecks } from '../domain/preSendChecks'
import { elapsedLabel } from '../domain/templateDraftStorage'
import { formFromTemplate, officialNameFrom } from '../domain/templateDraft'
import type { TemplateField, TemplateFormState } from '../domain/templateForm'
import { officialStatus, rejectedReason } from '../domain/templateList'
import { useTemplateCategories } from '../hooks/useTemplateCategories'
import { useTemplateEditor } from '../hooks/useTemplateEditor'
import { useTemplateCapabilities, useTemplates } from '../hooks/useTemplates'
import type { MessageTemplate, TemplateCapabilities, TemplateCategory, TemplateInteractiveType } from '../types'
import { InternalMessageSection } from './editor/InternalMessageSection'
import { OfficialMessageSection } from './editor/OfficialMessageSection'
import { OrganizationSection } from './editor/OrganizationSection'
import { ChoiceCard, EditorSection } from './editor/parts'
import { PreSendChecklist } from './editor/PreSendChecklist'
import { TemplateDetailsSection } from './editor/TemplateDetailsSection'
import { TemplatePreview } from './editor/TemplatePreview'

const LIST_PATH = '/templates'

function focusField(field: TemplateField) {
  // Dos cuadros: el campo puede recién aparecer con el error (el nombre en
  // Meta está plegado hasta que hace falta).
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const element = document.getElementById(fieldId(field))
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    element?.focus({ preventScroll: true })
  }))
}

function Notice({ tone, children, action }: { tone: 'info' | 'warning' | 'danger' | 'accent'; children: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'danger' ? AlertCircle : tone === 'warning' ? TriangleAlert : Info
  const toneClass = {
    info: 'bg-info-soft text-info-fg',
    warning: 'bg-warning-soft text-warning-fg',
    danger: 'bg-danger-soft text-danger-fg',
    accent: 'bg-accent-soft text-accent-deep',
  }[tone]
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl px-4 py-3 text-sm', toneClass)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-[1_1_14rem]">{children}</div>
      {action}
    </div>
  )
}

interface EditorProps {
  template: MessageTemplate | undefined
  seed?: TemplateFormState
  templates: MessageTemplate[]
  categories: TemplateCategory[]
  capabilities: TemplateCapabilities | undefined
  mediaAssets: MediaAsset[]
}

function TemplateEditor({ template, seed, templates, categories, capabilities, mediaAssets }: EditorProps) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const [pendingFormat, setPendingFormat] = useState<TemplateInteractiveType | null>(null)
  const limits = capabilities?.interactive_limits

  const editor = useTemplateEditor({
    template,
    seed,
    categories,
    limits,
    onSaved: (saved, outcome) => {
      toast.success(outcome === 'sent_to_review' ? 'Enviada a revisión de Meta' : 'Plantilla guardada', {
        description: outcome === 'sent_to_review' ? 'Queda «En revisión» en la lista hasta que Meta responda.' : undefined,
      })
      navigate(LIST_PATH, { state: { highlightId: saved.id } })
    },
    onAttachmentsFailed: (saved, message) => {
      toast.error('La plantilla se guardó, pero un archivo no se pudo subir', { description: message })
      navigate(`${LIST_PATH}/${saved.id}`, { replace: true, state: { reload: Date.now() } })
    },
    onInvalid: field => {
      setTab('edit')
      focusField(field)
    },
  })
  const { form, change, pendingIssues, saving } = editor
  const official = form.templateType === 'official'
  const status = template?.template_type === 'official' ? officialStatus(template.official_status) : null
  const sendsToReview = official && (!template || editor.goesBackToReview)
  const submitLabel = sendsToReview ? 'Enviar a revisión de Meta' : template ? 'Guardar cambios' : 'Guardar plantilla'
  const checks = official
    ? preSendChecks(form, templates.filter(other => other.template_type === 'official' && other.id !== template?.id).map(other => other.content))
    : []

  const stateLine = saving
    ? 'Guardando…'
    : editor.backedUp
      ? 'Cambios sin guardar, respaldados en este dispositivo'
      : editor.dirty ? 'Cambios sin guardar' : status?.label ?? (template ? 'Sin cambios' : 'Todavía no guardada')

  function leave() {
    if (editor.dirty) setConfirmingLeave(true)
    else navigate(LIST_PATH)
  }

  function changeFormat(format: TemplateInteractiveType) {
    if (format === form.interactiveType) return
    if (format !== 'none' && editor.attachments.length > 0) setPendingFormat(format)
    else change({ interactiveType: format })
  }

  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 lg:px-8">
          <Link to={LIST_PATH} className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-fg-muted outline-none hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />Plantillas
          </Link>
          <div className="min-w-0 flex-[1_1_12rem]">
            <h1 className="truncate text-xl font-semibold text-fg">{template ? `Editar «${template.name}»` : 'Nueva plantilla'}</h1>
            <p className="text-sm text-fg-muted">{official ? 'Oficial de Meta' : 'Interna'} · {stateLine}</p>
          </div>
          {pendingIssues.length > 0 && (
            <button type="button" onClick={() => { setTab('edit'); focusField(pendingIssues[0].field) }} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-danger-fg outline-none hover:bg-danger-soft focus-visible:ring-2 focus-visible:ring-ring">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              {pendingIssues.length === 1 ? 'Falta corregir 1 punto' : `Falta corregir ${pendingIssues.length} puntos`}
            </button>
          )}
          <div className="hidden gap-2 lg:flex">
            <Button variant="secondary" onClick={leave} disabled={saving}>Cancelar</Button>
            <Button type="submit" form="template-editor-form" loading={saving}>{submitLabel}</Button>
          </div>
        </div>
        {editor.serverError && (
          <div className="px-4 pb-3 lg:px-8">
            <Notice tone="danger"><p className="whitespace-pre-line font-medium">{editor.serverError}</p></Notice>
          </div>
        )}
        <div role="tablist" aria-label="Editar o ver la vista previa" className="grid grid-cols-2 px-4 lg:hidden">
          {([['edit', 'Editar'], ['preview', 'Vista previa']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn('h-11 border-b-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', tab === value ? 'border-accent-strong font-semibold text-accent-strong' : 'border-transparent font-medium text-fg-muted')}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1200px] items-start gap-6 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:px-8 lg:py-6">
          <form
            id="template-editor-form"
            noValidate
            onSubmit={event => { event.preventDefault(); void editor.submit() }}
            className={cn('flex min-w-0 flex-col gap-4', tab === 'preview' && 'hidden lg:flex')}
          >
            {editor.restoredAt != null && (
              <Notice
                tone="accent"
                action={<div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={editor.discardChanges}>Descartar</Button>
                  <Button variant="ghost" size="sm" onClick={editor.dismissRestored}>Entendido</Button>
                </div>}
              >
                <p><strong className="font-semibold">Recuperamos lo que habías escrito</strong> {elapsedLabel(editor.restoredAt)}. Los archivos que hubieras elegido no entran en el respaldo: vuelve a agregarlos.</p>
              </Notice>
            )}
            {status?.kind === 'rejected' && (
              <Notice tone="danger">
                <p className="font-semibold">Meta la rechazó</p>
                <p>{rejectedReason(template?.official_rejected_reason) ?? 'Meta no informó el motivo'}. Corrígela y vuelve a enviarla.</p>
              </Notice>
            )}
            {editor.metaLocked && official && status?.kind !== 'rejected' && (
              <Notice tone="warning">
                <p className="font-semibold">{editor.goesBackToReview ? 'Al guardar, Meta vuelve a revisarla' : 'Esta plantilla ya fue enviada a Meta'}</p>
                <p>{editor.goesBackToReview
                  ? 'Hasta que la apruebe no se podrá enviar, ni desde el chat ni desde las automatizaciones.'
                  : 'Si cambias el mensaje, los datos, el encabezado, el pie o los botones, vuelve a revisión. El nombre, la categoría del equipo y el atajo se cambian sin revisión.'}</p>
              </Notice>
            )}
            {official && capabilities && !capabilities.official_sending_supported && (
              <Notice tone="warning">
                <p className="font-semibold">WhatsApp no está conectado</p>
                <p>{capabilities.reason ?? 'Sin la conexión con Meta no se puede enviar la plantilla a revisión.'}</p>
              </Notice>
            )}

            {template ? (
              <section className="rounded-xl border border-line bg-surface px-4 py-3.5 sm:px-5">
                <h2 className="text-base font-semibold text-fg">{official ? 'Plantilla oficial de Meta' : 'Plantilla interna'}</h2>
                <p className="mt-0.5 text-sm text-fg-muted">
                  {official
                    ? 'Sirve para escribir primero o después de 24 horas sin respuesta.'
                    : 'Se envía al instante en chats donde el cliente escribió en las últimas 24 horas.'}{' '}
                  El tipo no se cambia después de crearla.
                </p>
              </section>
            ) : (
              <EditorSection title="¿Para qué la vas a usar?">
                <div className="grid gap-2 sm:grid-cols-2">
                  <ChoiceCard
                    name="template-type"
                    title="Responder en un chat abierto"
                    description="Plantilla interna. Se envía al instante, sin aprobación, si el cliente escribió en las últimas 24 horas."
                    checked={!official}
                    onSelect={() => change({ templateType: 'internal' })}
                  />
                  <ChoiceCard
                    name="template-type"
                    title="Escribir primero o después de 24 horas"
                    description="Plantilla oficial. Meta la revisa antes de que puedas enviarla."
                    checked={official}
                    onSelect={() => change({ templateType: 'official' })}
                  />
                </div>
              </EditorSection>
            )}

            <TemplateDetailsSection editor={editor} />
            {official
              ? <OfficialMessageSection editor={editor} limits={limits} mediaAssets={mediaAssets} />
              : <InternalMessageSection editor={editor} limits={limits} defaultFooter={capabilities?.interactive_default_footer} onFormatChange={changeFormat} />}
            <OrganizationSection editor={editor} categories={categories} />
          </form>

          <aside className={cn('flex min-w-0 flex-col gap-3 lg:sticky lg:top-6', tab === 'edit' && 'hidden lg:flex')}>
            <TemplatePreview form={form} attachments={editor.attachments} mediaAssets={mediaAssets} defaultFooter={capabilities?.interactive_default_footer} />
            {official && <PreSendChecklist checks={checks} />}
            {sendsToReview && (
              <Notice tone="info">
                <p className="font-semibold">Qué pasa al enviarla a revisión</p>
                <p>Meta suele responder en minutos y puede tardar hasta 48 horas. Mientras tanto queda «En revisión» y no se puede enviar a clientes. La lista se actualiza sola cuando Meta responde.</p>
              </Notice>
            )}
          </aside>
        </div>
      </div>

      <footer className="flex shrink-0 gap-2 border-t border-line bg-surface px-4 py-3 lg:hidden">
        <Button variant="secondary" size="lg" onClick={leave} disabled={saving}>Cancelar</Button>
        <Button type="submit" form="template-editor-form" size="lg" className="min-w-0 flex-1" loading={saving}>{submitLabel}</Button>
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
        description={`Si cambias de formato se ${editor.attachments.length === 1 ? 'quita el archivo' : `quitan los ${editor.attachments.length} archivos`} de esta plantilla. Lo que esté en tu biblioteca sigue ahí.`}
        cancelLabel="Dejar como está"
        confirmLabel="Cambiar de formato"
        confirmVariant="primary"
        onConfirm={() => {
          if (pendingFormat) {
            editor.setAttachments([])
            change({ interactiveType: pendingFormat })
          }
          setPendingFormat(null)
        }}
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
  const templates = useTemplates(true)
  const categories = useTemplateCategories()
  const capabilities = useTemplateCapabilities()
  const { data: mediaAssets = [] } = useMediaLibrary()
  const id = templateId === undefined ? null : Number(templateId)
  const state = location.state as { reload?: number; copyOf?: number } | null

  if (templates.isLoading || categories.isLoading || capabilities.isLoading) {
    return <div className="flex h-full items-center justify-center bg-canvas"><Spinner /></div>
  }
  const template = id == null ? undefined : templates.data?.find(item => item.id === id)
  if (id != null && !template) {
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
  // «Duplicar» abre una plantilla nueva con todo lo de otra salvo lo que
  // tiene que ser único: el atajo y el nombre con que Meta la registra. Los
  // archivos no se copian (se eligen de nuevo, desde la biblioteca).
  const source = id == null && state?.copyOf != null ? templates.data?.find(item => item.id === state.copyOf) : undefined
  const copyName = source ? `${source.name} (copia)`.slice(0, TEMPLATE_LIMITS.name) : ''
  const seed: TemplateFormState | undefined = source
    ? { ...formFromTemplate(source), name: copyName, shortcut: '', officialName: source.template_type === 'official' ? officialNameFrom(copyName) : '' }
    : undefined
  return (
    <TemplateEditor
      key={`${id ?? (source ? `copy-${source.id}` : 'new')}-${state?.reload ?? ''}`}
      template={template}
      seed={seed}
      templates={templates.data ?? []}
      categories={categories.data ?? []}
      capabilities={capabilities.data}
      mediaAssets={mediaAssets}
    />
  )
}
