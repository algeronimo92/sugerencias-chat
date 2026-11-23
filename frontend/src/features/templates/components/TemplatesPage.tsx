import { Download, FileText, Plus, Search, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { EmptyState, ErrorState } from '../../../shared/ui/EmptyState'
import { Select, pillFieldClass } from '../../../shared/ui/Input'
import { PageHeader } from '../../../shared/ui/PageHeader'
import { Spinner } from '../../../shared/ui/Spinner'
import { cn } from '../../../shared/utils/cn'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { defaultCategory } from '../domain/templateDraft'
import { clearTemplateDraft, elapsedLabel, loadTemplateDraft } from '../domain/templateDraftStorage'
import { NO_FILTERS, filterTemplates, hasFilters, officialStatus, rejectedReason, sortByUse, type StatusFilter, type TemplateListFilters, type TypeFilter } from '../domain/templateList'
import { useTemplateCategories } from '../hooks/useTemplateCategories'
import { useDeleteTemplate, useSyncTemplate, useTemplateCapabilities, useTemplates, useUpdateTemplate } from '../hooks/useTemplates'
import type { MessageTemplate } from '../types'
import { ImportMetaTemplatesDialog } from './ImportMetaTemplatesDialog'
import { LIST_GRID, TemplateListRow } from './TemplateListRow'

const NEW_PATH = '/templates/nueva'

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'internal', label: 'Internas' },
  { value: 'official', label: 'Oficiales' },
]

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
  const updateTemplate = useUpdateTemplate()
  const deleteTemplate = useDeleteTemplate()
  const syncTemplate = useSyncTemplate()
  const [filters, setFilters] = useState<TemplateListFilters>(NO_FILTERS)
  const [importing, setImporting] = useState(false)
  const [draft, setDraft] = useState(() => loadTemplateDraft(null))
  const highlightId = (location.state as { highlightId?: number } | null)?.highlightId
  const visible = sortByUse(filterTemplates(data, filters))
  const countOf = (type: TypeFilter) => type === 'all' ? data.length : data.filter(template => template.template_type === type).length
  const patch = (changes: Partial<TemplateListFilters>) => setFilters(current => ({ ...current, ...changes }))

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

  const busyId = updateTemplate.isPending ? updateTemplate.variables?.id
    : deleteTemplate.isPending ? deleteTemplate.variables
      : syncTemplate.isPending ? syncTemplate.variables : undefined

  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      <PageHeader
        title="Plantillas"
        description="Mensajes listos para el equipo y plantillas oficiales de WhatsApp."
        actions={<>
          <Button variant="secondary" onClick={() => setImporting(true)}><Download className="h-4 w-4" aria-hidden="true" />Importar desde Meta</Button>
          <Button asChild><Link to={NEW_PATH}><Plus className="h-4 w-4" aria-hidden="true" />Nueva plantilla</Link></Button>
        </>}
        toolbar={<>
          <div className="relative min-w-0 flex-[1_1_16rem] sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
            <input
              type="search"
              aria-label="Buscar plantillas"
              placeholder="Buscar por nombre, texto o atajo"
              value={filters.query}
              onChange={event => patch({ query: event.target.value })}
              className={cn(pillFieldClass, 'h-10 pl-9')}
            />
          </div>
          <div role="group" aria-label="Filtrar por tipo" className="flex gap-1 rounded-lg bg-subtle p-1">
            {TYPE_FILTERS.map(option => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filters.type === option.value}
                onClick={() => patch({ type: option.value })}
                className={cn(
                  'h-8 rounded-md px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  filters.type === option.value ? 'bg-surface font-semibold text-fg shadow-sm' : 'font-medium text-fg-muted hover:text-fg',
                )}
              >
                {option.label} <span className="tabular-nums">· {countOf(option.value)}</span>
              </button>
            ))}
          </div>
          <div className="w-full sm:w-44">
            <Select aria-label="Filtrar por estado" value={filters.status} onChange={event => patch({ status: event.target.value as StatusFilter })}>
              <option value="any">Cualquier estado</option>
              <option value="approved">Aprobada</option>
              <option value="review">En revisión</option>
              <option value="rejected">Rechazada</option>
              <option value="inactive">Desactivada</option>
            </Select>
          </div>
          <div className="w-full sm:w-48">
            <Select aria-label="Filtrar por categoría" value={filters.category} onChange={event => patch({ category: event.target.value })}>
              <option value="">Todas las categorías</option>
              {[...new Set(data.map(template => template.category))].sort((left, right) => left.localeCompare(right, 'es')).map(category => <option key={category} value={category}>{category}</option>)}
            </Select>
          </div>
        </>}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-4">
          {capabilities && !capabilities.official_sending_supported && (
            <div role="status" className="flex items-start gap-3 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p><strong className="font-semibold">WhatsApp no está conectado.</strong> {capabilities.reason ?? 'Las plantillas oficiales no se pueden enviar hasta conectarlo.'}</p>
            </div>
          )}
          {draft && (
            <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent-deep">
              <p className="min-w-0 flex-[1_1_14rem]">
                <strong className="font-semibold">Tienes un borrador sin terminar</strong>
                {draft.form.name.trim() ? `: «${draft.form.name.trim()}»` : ''}, de {elapsedLabel(draft.savedAt)}.
              </p>
              <Button size="sm" onClick={() => navigate(NEW_PATH)}>Retomar</Button>
              <Button variant="secondary" size="sm" onClick={() => { clearTemplateDraft(null); setDraft(null) }}>Descartar</Button>
            </div>
          )}

          {isLoading ? (
            <Spinner label="Cargando plantillas…" className="py-16" />
          ) : isError ? (
            <ErrorState title="No se pudieron cargar las plantillas" action={<Button variant="secondary" onClick={() => void refetch()}>Reintentar</Button>} />
          ) : data.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line-control bg-surface">
              <EmptyState
                icon={FileText}
                title="Aún no hay plantillas"
                description="Crea una respuesta para el equipo o importa las que ya tienes aprobadas en Meta."
                action={<Button asChild><Link to={NEW_PATH}><Plus className="h-4 w-4" aria-hidden="true" />Crear la primera plantilla</Link></Button>}
              />
            </div>
          ) : (
            <section aria-label="Plantillas del equipo" className="overflow-hidden rounded-xl border border-line bg-surface">
              <div aria-hidden="true" className={cn('hidden bg-subtle px-5 py-2.5 text-xs font-semibold text-fg-muted', LIST_GRID)}>
                <span>Plantilla</span><span>Estado</span><span>Categoría</span><span>Usos</span><span className="text-right">Acciones</span>
              </div>
              {visible.length === 0 ? (
                <EmptyState
                  compact
                  title={filters.query.trim() ? `Ninguna plantilla coincide con «${filters.query.trim()}»` : 'Ninguna plantilla coincide con los filtros'}
                  description="Prueba con otra palabra o quita los filtros."
                  action={<Button variant="secondary" size="sm" onClick={() => setFilters(NO_FILTERS)}>Quitar filtros</Button>}
                />
              ) : (
                <ul>
                  {visible.map(template => (
                    <TemplateListRow
                      key={template.id}
                      template={template}
                      highlighted={template.id === highlightId}
                      busy={busyId === template.id}
                      onToggleActive={active => toggleActive(template, active)}
                      onSync={() => sync(template)}
                      onDuplicate={() => navigate(NEW_PATH, { state: { copyOf: template.id } })}
                      onDelete={() => remove(template)}
                    />
                  ))}
                </ul>
              )}
            </section>
          )}

          {data.length > 0 && (
            <p className="px-1 text-xs text-fg-muted">
              {hasFilters(filters) ? `${visible.length} de ${data.length} plantillas` : `${data.length} plantilla${data.length === 1 ? '' : 's'}`}, las más usadas primero. El estado de Meta se actualiza solo.
            </p>
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
