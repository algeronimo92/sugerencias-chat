import { useEffect, useState } from 'react'
import { Check, Loader2, Plus, Save, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { LeadService } from '../types'
import { useCreateLeadService, useLeadServices, useUpdateLeadService } from '../hooks/useLeadServices'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'

export function ServicesManagementPanel() {
  const { data: services = [], isLoading, error: loadError } = useLeadServices(true)
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

  if (isLoading) return <p className="py-8 text-center text-sm text-wa-muted">Cargando servicios…</p>
  if (loadError) return <p className="py-8 text-center text-sm text-red-500">No se pudieron cargar los servicios.</p>

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-wa-primary-strong dark:text-wa-primary" />
          <h2 className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Administrar servicios</h2>
        </div>
        <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
          Estos servicios aparecen al crear o editar un lead y en las automatizaciones. Los inactivos permanecen en el historial.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-2 rounded-xl border border-wa-border bg-wa-hover p-3 dark:border-wa-border-dark dark:bg-wa-head-dark sm:flex-row sm:items-center">
        <input
          value={newName}
          onChange={event => setNewName(event.target.value)}
          maxLength={120}
          placeholder="Nombre del nuevo servicio"
          className="min-w-0 flex-1 rounded-lg border border-wa-border bg-white px-3 py-2 text-sm text-wa-text outline-none focus:ring-2 focus:ring-wa-primary/60 dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
        />
        <Button type="submit" disabled={!newName.trim() || createService.isPending} className="shrink-0">
          {createService.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Crear servicio
        </Button>
      </form>

      <div className="space-y-2">
        {services.map(service => {
          const draft = drafts[service.id] ?? service.name
          const isActive = service.is_active !== false
          const changed = draft.trim() !== service.name
          const isThisPending = updateService.isPending && updateService.variables?.id === service.id
          return (
            <div key={service.id} className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center ${isActive ? 'border-wa-border dark:border-wa-border-dark' : 'border-dashed border-wa-border bg-wa-hover/70 opacity-70 dark:border-wa-border-dark dark:bg-wa-head-dark/60'}`}>
              <input
                value={draft}
                onChange={event => setDrafts(current => ({ ...current, [service.id]: event.target.value }))}
                maxLength={120}
                aria-label={`Nombre de ${service.name}`}
                className="min-w-0 flex-1 rounded-lg border border-wa-border bg-white px-3 py-1.5 text-sm text-wa-text outline-none focus:ring-2 focus:ring-wa-primary/60 dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleSave(service)}
                  disabled={!changed || isThisPending}
                  aria-label={`Guardar ${service.name}`}
                >
                  {isThisPending && changed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Guardar
                </Button>
                <button
                  type="button"
                  onClick={() => handleToggle(service)}
                  disabled={isThisPending}
                  aria-pressed={isActive}
                  title={isActive ? `Desactivar ${service.name}` : `Activar ${service.name}`}
                  className={`inline-flex h-7 min-w-24 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold shadow-sm outline-none transition-[color,background-color,border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-wa-primary/60 disabled:cursor-wait disabled:opacity-50 ${isActive ? 'border border-wa-primary bg-wa-primary text-white hover:border-wa-primary-strong hover:bg-wa-primary-strong dark:border-wa-primary dark:bg-wa-primary dark:text-white' : 'border border-wa-border bg-white text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark dark:hover:text-wa-text-dark'}`}
                >
                  {isThisPending && !changed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isActive ? <Check className="h-3.5 w-3.5" /> : null}
                  {isActive ? 'Activo' : 'Inactivo'}
                </button>
              </div>
            </div>
          )
        })}
        {services.length === 0 && <p className="rounded-xl border border-dashed border-wa-border py-8 text-center text-sm text-wa-muted dark:border-wa-border-dark">Todavía no hay servicios.</p>}
      </div>

      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
    </div>
  )
}
