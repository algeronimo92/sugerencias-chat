import { Download, FileText, Plus, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { EmptyState, ErrorState } from '../../../shared/ui/EmptyState'
import { PageHeader } from '../../../shared/ui/PageHeader'
import { Spinner } from '../../../shared/ui/Spinner'
import { cn } from '../../../shared/utils/cn'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { defaultCategory } from '../domain/templateDraft'
import { clearTemplateDraft, elapsedLabel, loadTemplateDraft, type StoredTemplateDraft } from '../domain/templateDraftStorage'
import { NO_FILTERS, filterTemplates, hasFilters, officialStatus, rejectedReason, sortByUse, type TemplateListFilters, type TypeFilter } from '../domain/templateList'
import { useTemplateCategories } from '../hooks/useTemplateCategories'
import { useDeleteTemplate, useSyncTemplate, useTemplateCapabilities, useTemplates, useUpdateTemplate } from '../hooks/useTemplates'
import type { MessageTemplate } from '../types'
import { ImportMetaTemplatesDialog } from './ImportMetaTemplatesDialog'
import { LIST_GRID, TemplateListRow } from './TemplateListRow'
import { TemplatesToolbar } from './TemplatesToolbar'

const NEW_PATH = '/templates/nueva'

/** Activar, consultar a Meta y eliminar, con el aviso de cada resultado. */
function useTemplateRowActions() {
  const updateTemplate = useUpdateTemplate()
  const deleteTemplate = useDeleteTemplate()
  const syncTemplate = useSyncTemplate()

  function toggleActive(template: MessageTemplate, active: boolean) {
    updateTemplate.mutate({ id: template.id, is_active: active }, {
      onSuccess: () => toast.success(active ? 'Plantilla activada' : 'Plantilla desactivada'),
      onError: reason => toast.error('No se pudo cambiar la plantilla', { description: extractErrorMessage(reason) }),
    })
  }

  function sync(template: MessageTemplate) {
    syncTemplate.mutate(template.id, {
      onSuccess: updated => {
        const status = officialStatus(updated.official_status)
        const reason = status.kind === 'rejected' ? rejectedReason(updated.official_rejected_reason) : null
        toast.success(`Estado en Meta: ${status.label}`, { description: reason ?? undefined })
      },
      onError: reason => toast.error('No se pudo consultar a Meta', { description: extractErrorMessage(reason) }),
    })
  }

  function remove(template: MessageTemplate) {
    deleteTemplate.mutate(template.id, {
      onSuccess: () => toast.success(`«${template.name}» fue eliminada`),
      onError: reason => toast.error('No se pudo eliminar', { description: extractErrorMessage(reason) }),
    })
  }

  /** La plantilla con una acción en curso, para bloquear solo su fila. */
  function busyId(): number | undefined {
    if (updateTemplate.isPending) return updateTemplate.variables?.id
    if (deleteTemplate.isPending) return deleteTemplate.variables
    return syncTemplate.isPending ? syncTemplate.variables : undefined
  }

  return { toggleActive, sync, remove, busyId: busyId() }
}

/** Un borrador de plantilla nueva que quedó sin terminar en este dispositivo. */
function DraftBanner({ draft, onResume, onDiscard }: { draft: StoredTemplateDraft; onResume: () => void; onDiscard: () => void }) {
  const name = draft.form.name.trim()
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent-deep">
      <p className="min-w-0 flex-[1_1_14rem]">
        <strong className="font-semibold">Tienes un borrador sin terminar</strong>
        {name ? `: «${name}»` : ''}, de {elapsedLabel(draft.savedAt)}.
      </p>
      <Button size="sm" onClick={onResume}>Retomar</Button>
      <Button variant="secondary" size="sm" onClick={onDiscard}>Descartar</Button>
    </div>
  )
}

interface ListProps {
  /** Las plantillas tras buscar y filtrar, ya ordenadas. */
  templates: MessageTemplate[]
  query: string
  highlightId: number | undefined
  onClearFilters: () => void
  onDuplicate: (template: MessageTemplate) => void
}

function TemplatesTable({ templates, query, highlightId, onClearFilters, onDuplicate }: ListProps) {
  const actions = useTemplateRowActions()
  return (
    <section aria-label="Plantillas del equipo" className="overflow-hidden rounded-xl border border-line bg-surface">
      <div aria-hidden="true" className={cn('hidden bg-subtle px-5 py-2.5 text-xs font-semibold text-fg-muted', LIST_GRID)}>
        <span>Plantilla</span><span>Estado</span><span>Categoría</span><span>Usos</span><span className="text-right">Acciones</span>
      </div>
      {templates.length === 0 ? (
        <EmptyState
          compact
          title={query ? `Ninguna plantilla coincide con «${query}»` : 'Ninguna plantilla coincide con los filtros'}
          description="Prueba con otra palabra o quita los filtros."
          action={<Button variant="secondary" size="sm" onClick={onClearFilters}>Quitar filtros</Button>}
        />
      ) : (
        <ul>
          {templates.map(template => (
            <TemplateListRow
              key={template.id}
              template={template}
              highlighted={template.id === highlightId}
              busy={actions.busyId === template.id}
              onToggleActive={active => actions.toggleActive(template, active)}
              onSync={() => actions.sync(template)}
              onDuplicate={() => onDuplicate(template)}
              onDelete={() => actions.remove(template)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/** Lo que ocupa el lugar de la lista mientras no hay nada que listar. */
function listPlaceholder(query: { isLoading: boolean; isError: boolean; isEmpty: boolean; onRetry: () => void }): ReactNode | null {
  if (query.isLoading) return <Spinner label="Cargando plantillas…" className="py-16" />
  if (query.isError) {
    return <ErrorState title="No se pudieron cargar las plantillas" action={<Button variant="secondary" onClick={query.onRetry}>Reintentar</Button>} />
  }
  if (!query.isEmpty) return null
  return (
    <div className="rounded-xl border border-dashed border-line-control bg-surface">
      <EmptyState
        icon={FileText}
        title="Aún no hay plantillas"
        description="Crea una respuesta para el equipo o importa las que ya tienes aprobadas en Meta."
        action={<Button asChild><Link to={NEW_PATH}><Plus className="h-4 w-4" aria-hidden="true" />Crear la primera plantilla</Link></Button>}
      />
    </div>
  )
}

/**
 * La lista de plantillas del equipo (2026-11-23).
 *
 * Antes la pantalla abría con cuatro indicadores que no filtraban nada y un
 * aviso permanente de «WhatsApp conectado», y el formulario se incrustaba
 * entre ellos y las tarjetas. Ahora es solo la lista: buscador, filtros por
 * tipo, estado y categoría, y el estado de Meta a la vista. Crear y editar
 * tienen su propia pantalla (`TemplateEditorPage`).
 */
export function TemplatesPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data = [], isLoading, isError, refetch } = useTemplates(true)
  const { data: categories = [] } = useTemplateCategories()
  const { data: capabilities } = useTemplateCapabilities()
  const [filters, setFilters] = useState<TemplateListFilters>(NO_FILTERS)
  const [importing, setImporting] = useState(false)
  const [draft, setDraft] = useState(() => loadTemplateDraft(null))
  const highlightId = (location.state as { highlightId?: number } | null)?.highlightId
  const visible = sortByUse(filterTemplates(data, filters))
  const counts: Record<TypeFilter, number> = {
    all: data.length,
    internal: data.filter(template => template.template_type === 'internal').length,
    official: data.filter(template => template.template_type === 'official').length,
  }
  const usedCategories = [...new Set(data.map(template => template.category))].sort((left, right) => left.localeCompare(right, 'es'))
  const placeholder = listPlaceholder({ isLoading, isError, isEmpty: data.length === 0, onRetry: () => void refetch() })
  const disconnected = capabilities != null && !capabilities.official_sending_supported
  const summary = hasFilters(filters) ? `${visible.length} de ${data.length} plantillas` : `${data.length} plantilla${data.length === 1 ? '' : 's'}`

  function discardDraft() {
    clearTemplateDraft(null)
    setDraft(null)
  }

  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      <PageHeader
        title="Plantillas"
        description="Mensajes listos para el equipo y plantillas oficiales de WhatsApp."
        actions={<>
          <Button variant="secondary" onClick={() => setImporting(true)}><Download className="h-4 w-4" aria-hidden="true" />Importar desde Meta</Button>
          <Button asChild><Link to={NEW_PATH}><Plus className="h-4 w-4" aria-hidden="true" />Nueva plantilla</Link></Button>
        </>}
        toolbar={<TemplatesToolbar filters={filters} counts={counts} categories={usedCategories} onChange={changes => setFilters(current => ({ ...current, ...changes }))} />}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-4">
          {disconnected && (
            <div role="status" className="flex items-start gap-3 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p><strong className="font-semibold">WhatsApp no está conectado.</strong> {capabilities.reason ?? 'Las plantillas oficiales no se pueden enviar hasta conectarlo.'}</p>
            </div>
          )}
          {draft && <DraftBanner draft={draft} onResume={() => navigate(NEW_PATH)} onDiscard={discardDraft} />}

          {placeholder ?? (
            <>
              <TemplatesTable
                templates={visible}
                query={filters.query.trim()}
                highlightId={highlightId}
                onClearFilters={() => setFilters(NO_FILTERS)}
                onDuplicate={template => navigate(NEW_PATH, { state: { copyOf: template.id } })}
              />
              <p className="px-1 text-xs text-fg-muted">{summary}, las más usadas primero. El estado de Meta se actualiza solo.</p>
            </>
          )}
        </div>
      </div>

      {importing && (
        <ImportMetaTemplatesDialog
          existingMetaIds={new Set(data.flatMap(template => template.meta_template_id ? [template.meta_template_id] : []))}
          categories={categories}
          defaultCategory={defaultCategory(categories) || undefined}
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  )
}
