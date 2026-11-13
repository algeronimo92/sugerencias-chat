import { Database, Loader2, Lock, PencilLine, Plus, Sparkles } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { CatalogPanel } from '../../../shared/ui/CatalogPanel'
import { Input } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useCreateLeadService, useLeadServices, useUpdateLeadService } from '../hooks/useLeadServices'
import type { LeadService } from '../types'
import { DeleteServiceButton } from './DeleteServiceButton'
import { ErpSyncCard } from './ErpSyncCard'
import { ServicePackagesEditor } from './ServicePackagesEditor'

/** Lo editable de una fila es el nombre (y solo en los manuales). El precio
 *  vive en los paquetes, y qué resuelve el servicio y sus condiciones, en sus
 *  fichas para la IA: antes había dos campos acá que repetían esas fichas. */
interface ServiceDraft {
  name: string
}

function draftFrom(service: LeadService): ServiceDraft {
  return { name: service.name }
}

function changedFields(service: LeadService, draft: ServiceDraft) {
  const changes: { name?: string } = {}
  if (draft.name.trim() !== service.name) changes.name = draft.name.trim()
  return changes
}

type Origin = 'all' | 'erp' | 'manual'

const isFromErp = (service: LeadService) => Boolean(service.external_id)

/** De dónde viene el servicio: lo que trae el ERP es de solo lectura (nombre,
 *  paquetes, alta y baja); lo manual se edita acá. Antes solo se notaba porque
 *  el nombre de algunos no se podía cambiar. */
function OriginBadge({ service }: { service: LeadService }) {
  return isFromErp(service) ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
      <Database className="h-3 w-3" aria-hidden="true" />
      ERP · solo lectura
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-wa-field px-2 py-0.5 text-[11px] font-semibold text-wa-muted dark:bg-wa-head-dark dark:text-wa-muted-dark">
      <PencilLine className="h-3 w-3" aria-hidden="true" />
      Manual · editable
    </span>
  )
}

function OriginFilter({ value, counts, onChange }: { value: Origin; counts: Record<Origin, number>; onChange: (value: Origin) => void }) {
  const options: { key: Origin; label: string }[] = [
    { key: 'all', label: 'Todos' },
    { key: 'erp', label: 'Del ERP' },
    { key: 'manual', label: 'Manuales' },
  ]
  return (
    <div role="group" aria-label="Filtrar por origen" className="inline-flex rounded-lg border border-wa-border bg-white p-0.5 dark:border-wa-border-dark dark:bg-wa-panel-dark">
      {options.map(option => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${value === option.key ? 'bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary' : 'text-wa-muted hover:text-wa-text dark:text-wa-muted-dark dark:hover:text-wa-text-dark'}`}
        >
          {option.label} <span className="tabular-nums opacity-70">{counts[option.key]}</span>
        </button>
      ))}
    </div>
  )
}

interface Props {
  /** Lo que otras features agregan a cada servicio (p. ej. sus fichas para la
   *  IA). Llega armado desde app/: catálogos no conoce a esas features. */
  renderServiceExtras?: (service: LeadService) => ReactNode
}

export function ServicesManagementPanel({ renderServiceExtras }: Props = {}) {
  const { data: services = [], isLoading, error: loadError, refetch } = useLeadServices(true)
  const createService = useCreateLeadService()
  const updateService = useUpdateLeadService()
  const [newName, setNewName] = useState('')
  const [drafts, setDrafts] = useState<Record<number, ServiceDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [origin, setOrigin] = useState<Origin>('all')
  const erpCount = services.filter(isFromErp).length
  const counts = { all: services.length, erp: erpCount, manual: services.length - erpCount }
  const visibleServices = origin === 'all' ? services : services.filter(service => isFromErp(service) === (origin === 'erp'))

  useEffect(() => {
    setDrafts(current => {
      const next = { ...current }
      let changed = false
      for (const service of services) {
        if (!(service.id in next)) {
          next[service.id] = draftFrom(service)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [services])

  function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    const name = newName.trim()
    if (!name || createService.isPending) return
    setError(null)
    createService.mutate(name, {
      onSuccess: () => {
        setNewName('')
        toast.success('Servicio creado')
      },
      onError: err => setError(extractErrorMessage(err)),
    })
  }

  function draftOf(service: LeadService) {
    return drafts[service.id] ?? draftFrom(service)
  }

  function setDraftField(service: LeadService, field: keyof ServiceDraft, value: string) {
    setDrafts(current => ({ ...current, [service.id]: { ...(current[service.id] ?? draftFrom(service)), [field]: value } }))
  }

  function handleSave(service: LeadService) {
    const changes = changedFields(service, draftOf(service))
    if (changes.name === '') {
      setError('El nombre del servicio es obligatorio')
      return
    }
    setError(null)
    updateService.mutate({ id: service.id, ...changes }, {
      onSuccess: updated => {
        setDrafts(current => ({ ...current, [service.id]: draftFrom(updated) }))
        toast.success('Servicio actualizado')
      },
      onError: err => setError(extractErrorMessage(err)),
    })
  }

  function handleToggle(service: LeadService) {
    const nextActive = service.is_active === false
    setError(null)
    updateService.mutate({ id: service.id, is_active: nextActive }, {
      onSuccess: () => toast.success(nextActive ? 'Servicio activado' : 'Servicio desactivado'),
      onError: err => setError(extractErrorMessage(err)),
    })
  }

  return (
    <>
    <ErpSyncCard />
    <CatalogPanel
      icon={Sparkles}
      title="Administrar servicios"
      items={visibleServices}
      toolbar={erpCount > 0 ? <OriginFilter value={origin} counts={counts} onChange={setOrigin} /> : undefined}
      getId={service => service.id}
      getName={service => service.name}
      isLoading={isLoading}
      error={loadError}
      onRetry={() => { void refetch() }}
      loadErrorTitle="No pudimos cargar los servicios"
      searchPlaceholder="Buscar servicio"
      singularNoun="servicio"
      pluralNoun="servicios"
      emptyTitle="Todavía no hay servicios"
      emptyDescription="Añade un servicio para que tu equipo pueda elegirlo en los leads."
      isActive={service => service.is_active !== false}
      hasChanges={service => Object.keys(changedFields(service, draftOf(service))).length > 0}
      canSave={service => !isFromErp(service)}
      isPending={service => updateService.isPending && updateService.variables?.id === service.id}
      onSave={handleSave}
      onToggle={handleToggle}
      canToggle={service => !service.external_id}
      renderActions={service => (isFromErp(service) ? null : <DeleteServiceButton service={service} />)}
      formError={error}
      createForm={
        <form onSubmit={handleCreate} className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
          <label htmlFor="new-service-name" className="block min-w-0 flex-1 text-sm font-medium text-wa-text dark:text-wa-text-dark">
            Nombre del nuevo servicio
            <Input
              id="new-service-name"
              value={newName}
              onChange={event => setNewName(event.target.value)}
              maxLength={120}
              placeholder="Ej. Limpieza facial"
              className="mt-2 h-10 border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-head-dark"
            />
          </label>
          <Button type="submit" disabled={!newName.trim() || createService.isPending} className="h-10 shrink-0 bg-wa-primary-strong hover:bg-wa-primary-deep">
            {createService.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Crear servicio
          </Button>
        </form>
      }
      renderFields={service => (
        <div className="min-w-0 flex-1">
          <div className="mb-1.5"><OriginBadge service={service} /></div>
          {isFromErp(service) ? (
            <p className="flex items-center gap-1.5 py-1.5 text-sm font-medium text-wa-text dark:text-wa-text-dark" title="El nombre lo administra el ERP">
              <Lock className="h-3.5 w-3.5 shrink-0 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
              <span className="min-w-0 truncate">{service.name}</span>
              <span className="sr-only">(nombre administrado por el ERP)</span>
            </p>
          ) : (
            <Input
              value={draftOf(service).name}
              onChange={event => setDraftField(service, 'name', event.target.value)}
              maxLength={120}
              aria-label={`Nombre de ${service.name}`}
              className="w-full bg-white py-1.5 dark:bg-wa-panel-dark"
            />
          )}
          <ServicePackagesEditor service={service} onError={setError} />
          {renderServiceExtras?.(service)}
          <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
            {service.external_id ? 'Sincronizado desde el ERP' : `Creado por ${service.created_by_name ?? 'Sistema'}`}
            {service.created_at ? ` · ${new Date(service.created_at).toLocaleDateString('es-PE')}` : ''}
          </p>
        </div>
      )}
    />
    </>
  )
}
