import { useEffect, useState } from 'react'
import { Loader2, Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { LeadService } from '../types'
import { useCreateLeadService, useLeadServices, useUpdateLeadService } from '../hooks/useLeadServices'
import { extractErrorMessage } from '../utils/errors'
import { CatalogPanel } from './CatalogPanel'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

export function ServicesManagementPanel() {
  const { data: services = [], isLoading, error: loadError, refetch } = useLeadServices(true)
  const createService = useCreateLeadService()
  const updateService = useUpdateLeadService()
  const [newName, setNewName] = useState('')
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDrafts(current => {
      const next = { ...current }
      let changed = false
      for (const service of services) {
        if (!(service.id in next)) {
          next[service.id] = service.name
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

  function handleSave(service: LeadService) {
    const name = (drafts[service.id] ?? service.name).trim()
    if (!name) {
      setError('El nombre del servicio es obligatorio')
      return
    }
    setError(null)
    updateService.mutate({ id: service.id, name }, {
      onSuccess: () => toast.success('Servicio actualizado'),
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
      description="Estos servicios aparecen al crear o editar un lead y en las automatizaciones. Los inactivos permanecen en el historial."
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
      hasChanges={service => (drafts[service.id] ?? service.name).trim() !== service.name}
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
            value={drafts[service.id] ?? service.name}
            onChange={event => setDrafts(current => ({ ...current, [service.id]: event.target.value }))}
            maxLength={120}
            aria-label={`Nombre de ${service.name}`}
            className="w-full bg-white py-1.5 dark:bg-wa-panel-dark"
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
