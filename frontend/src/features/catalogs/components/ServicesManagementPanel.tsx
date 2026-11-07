import { Loader2, Plus, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { CatalogPanel } from '../../../shared/ui/CatalogPanel'
import { Input } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useCreateLeadService, useLeadServices, useUpdateLeadService } from '../hooks/useLeadServices'
import type { LeadService } from '../types'
import { ErpSyncCard } from './ErpSyncCard'
import { ServicePackagesEditor } from './ServicePackagesEditor'

/** Campos editables de una fila. El precio no está: vive en los paquetes. */
interface ServiceDraft {
  name: string
  price_notes: string
  description: string
}

function draftFrom(service: LeadService): ServiceDraft {
  return {
    name: service.name,
    price_notes: service.price_notes ?? '',
    description: service.description ?? '',
  }
}

/** Solo lo que cambió: renombrar no debe reescribir la descripción ni al revés. */
function changedFields(service: LeadService, draft: ServiceDraft) {
  const original = draftFrom(service)
  const changes: { name?: string; price_notes?: string; description?: string } = {}
  if (draft.name.trim() !== original.name) changes.name = draft.name.trim()
  if (draft.price_notes.trim() !== original.price_notes) changes.price_notes = draft.price_notes.trim()
  if (draft.description.trim() !== original.description) changes.description = draft.description.trim()
  return changes
}

export function ServicesManagementPanel() {
  const { data: services = [], isLoading, error: loadError, refetch } = useLeadServices(true)
  const createService = useCreateLeadService()
  const updateService = useUpdateLeadService()
  const [newName, setNewName] = useState('')
  const [drafts, setDrafts] = useState<Record<number, ServiceDraft>>({})
  const [error, setError] = useState<string | null>(null)

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
      description="Un servicio es el problema que el cliente quiere resolver; lo que se vende son sus paquetes (1 sesión, pack x3…). Los servicios aparecen al crear o editar un lead y en las automatizaciones; el asistente IA cotiza con los paquetes y la descripción. Los inactivos permanecen en el historial."
      items={services}
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
      isPending={service => updateService.isPending && updateService.variables?.id === service.id}
      onSave={handleSave}
      onToggle={handleToggle}
      canToggle={service => !service.external_id}
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
          <Input
            value={draftOf(service).name}
            onChange={event => setDraftField(service, 'name', event.target.value)}
            maxLength={120}
            readOnly={Boolean(service.external_id)}
            title={service.external_id ? 'El nombre lo administra el ERP' : undefined}
            aria-label={`Nombre de ${service.name}`}
            className={`w-full bg-white py-1.5 dark:bg-wa-panel-dark ${service.external_id ? 'text-wa-muted dark:text-wa-muted-dark' : ''}`}
          />
          <Input
            value={draftOf(service).description}
            onChange={event => setDraftField(service, 'description', event.target.value)}
            maxLength={1000}
            placeholder="Qué problema resuelve y para quién es (lo usa el asistente IA)"
            aria-label={`Descripción de ${service.name}`}
            className="mt-2 w-full bg-white py-1.5 dark:bg-wa-panel-dark"
          />
          <Input
            value={draftOf(service).price_notes}
            onChange={event => setDraftField(service, 'price_notes', event.target.value)}
            maxLength={500}
            placeholder="Condiciones: promociones, vigencia (opcional)"
            aria-label={`Notas de precio de ${service.name}`}
            className="mt-2 w-full bg-white py-1.5 dark:bg-wa-panel-dark"
          />
          <ServicePackagesEditor service={service} onError={setError} />
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
