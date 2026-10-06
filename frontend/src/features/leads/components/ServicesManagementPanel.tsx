import { Loader2, Plus, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { CatalogPanel } from '../../../shared/ui/CatalogPanel'
import { Input } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useCreateLeadService, useLeadServices, useUpdateLeadService } from '../hooks/useLeadServices'
import type { LeadService } from '../types'

/** Campos editables de una fila; el precio viaja como texto hasta guardarlo. */
interface ServiceDraft {
  name: string
  price: string
  price_notes: string
  description: string
}

function draftFrom(service: LeadService): ServiceDraft {
  return {
    name: service.name,
    price: service.price ?? '',
    price_notes: service.price_notes ?? '',
    description: service.description ?? '',
  }
}

/** Solo lo que cambió: renombrar no debe reescribir el precio ni al revés. */
function changedFields(service: LeadService, draft: ServiceDraft) {
  const original = draftFrom(service)
  const changes: { name?: string; price?: string | null; price_notes?: string; description?: string } = {}
  if (draft.name.trim() !== original.name) changes.name = draft.name.trim()
  if (draft.price.trim() !== original.price) changes.price = draft.price.trim() || null
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
    if (changes.price && !(Number(changes.price) >= 0)) {
      setError('El precio debe ser un número mayor o igual a cero')
      return
    }
    setError(null)
    updateService.mutate({ id: service.id, ...changes }, {
      onSuccess: updated => {
        // El backend normaliza el precio ("150" -> "150.00"): sin esto la
        // fila seguiría marcada como modificada.
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
    <CatalogPanel
      icon={Sparkles}
      title="Administrar servicios"
      description="Estos servicios aparecen al crear o editar un lead y en las automatizaciones. El asistente IA cotiza con su precio y descripción. Los inactivos permanecen en el historial."
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
            aria-label={`Nombre de ${service.name}`}
            className="w-full bg-white py-1.5 dark:bg-wa-panel-dark"
          />
          <div className="mt-2 grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={draftOf(service).price}
              onChange={event => setDraftField(service, 'price', event.target.value)}
              placeholder="Precio"
              aria-label={`Precio de ${service.name}`}
              className="bg-white py-1.5 dark:bg-wa-panel-dark"
            />
            <Input
              value={draftOf(service).price_notes}
              onChange={event => setDraftField(service, 'price_notes', event.target.value)}
              maxLength={500}
              placeholder="Packs o promociones (opcional)"
              aria-label={`Notas de precio de ${service.name}`}
              className="bg-white py-1.5 dark:bg-wa-panel-dark"
            />
          </div>
          <Input
            value={draftOf(service).description}
            onChange={event => setDraftField(service, 'description', event.target.value)}
            maxLength={1000}
            placeholder="Qué es y para quién es (lo usa el asistente IA)"
            aria-label={`Descripción de ${service.name}`}
            className="mt-2 w-full bg-white py-1.5 dark:bg-wa-panel-dark"
          />
          <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
            Creado por {service.created_by_name ?? 'Sistema'}
            {service.created_at ? ` · ${new Date(service.created_at).toLocaleDateString('es-PE')}` : ''}
          </p>
        </div>
      )}
    />
  )
}
