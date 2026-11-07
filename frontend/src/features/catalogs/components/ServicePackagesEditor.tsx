import { Check, Loader2, Package, Plus, Save, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useCreateServicePackage, useUpdateServicePackage } from '../hooks/useLeadServices'
import type { LeadService, ServicePackage } from '../types'

/**
 * Paquetes de un servicio (1 sesión, pack x3...). El cliente llega con un
 * problema y el vendedor cierra con el paquete que lo resuelve: por eso el
 * precio vive acá y no en el servicio. Un servicio sin paquetes activos no
 * se cotiza (ni lo cotiza el asistente IA).
 */
interface PackageDraft {
  name: string
  sessions: string
  price: string
}

const EMPTY_DRAFT: PackageDraft = { name: '', sessions: '1', price: '' }

function draftFrom(pkg: ServicePackage): PackageDraft {
  return { name: pkg.name, sessions: String(pkg.sessions), price: pkg.price }
}

/** Solo lo que cambió, ya validado; `null` si algún campo no sirve. */
function changedFields(pkg: ServicePackage, draft: PackageDraft) {
  const original = draftFrom(pkg)
  const changes: { name?: string; sessions?: number; price?: string } = {}
  if (draft.name.trim() !== original.name) changes.name = draft.name.trim()
  if (draft.sessions.trim() !== original.sessions) changes.sessions = Number(draft.sessions)
  if (draft.price.trim() !== original.price) changes.price = draft.price.trim()
  return changes
}

function validate(draft: PackageDraft): string | null {
  if (!draft.name.trim()) return 'El paquete necesita un nombre (ej. Pack x3)'
  const sessions = Number(draft.sessions)
  if (!Number.isInteger(sessions) || sessions < 1) return 'Las sesiones deben ser un entero mayor o igual a uno'
  if (draft.price.trim() === '' || !(Number(draft.price) >= 0)) return 'El precio debe ser un número mayor o igual a cero'
  return null
}

interface Props {
  service: LeadService
  onError: (message: string | null) => void
}

export function ServicePackagesEditor({ service, onError }: Props) {
  const packages = service.packages ?? []
  const createPackage = useCreateServicePackage()
  const updatePackage = useUpdateServicePackage()
  const [drafts, setDrafts] = useState<Record<number, PackageDraft>>({})
  const [adding, setAdding] = useState(false)
  const [newDraft, setNewDraft] = useState<PackageDraft>(EMPTY_DRAFT)

  function draftOf(pkg: ServicePackage) {
    return drafts[pkg.id] ?? draftFrom(pkg)
  }

  function setDraftField(pkg: ServicePackage, field: keyof PackageDraft, value: string) {
    setDrafts(current => ({ ...current, [pkg.id]: { ...(current[pkg.id] ?? draftFrom(pkg)), [field]: value } }))
  }

  function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    const problem = validate(newDraft)
    if (problem) {
      onError(problem)
      return
    }
    onError(null)
    createPackage.mutate(
      { serviceId: service.id, name: newDraft.name.trim(), sessions: Number(newDraft.sessions), price: newDraft.price.trim() },
      {
        onSuccess: () => {
          setNewDraft(EMPTY_DRAFT)
          setAdding(false)
          toast.success('Paquete añadido')
        },
        onError: err => onError(extractErrorMessage(err)),
      },
    )
  }

  function handleSave(pkg: ServicePackage) {
    const draft = draftOf(pkg)
    const problem = validate(draft)
    if (problem) {
      onError(problem)
      return
    }
    onError(null)
    updatePackage.mutate({ serviceId: service.id, id: pkg.id, ...changedFields(pkg, draft) }, {
      onSuccess: updated => {
        // El backend normaliza el precio ("400" -> "400.00"): sin esto la
        // fila seguiría marcada como modificada.
        setDrafts(current => ({ ...current, [pkg.id]: draftFrom(updated) }))
        toast.success('Paquete actualizado')
      },
      onError: err => onError(extractErrorMessage(err)),
    })
  }

  function handleToggle(pkg: ServicePackage) {
    const nextActive = !pkg.is_active
    onError(null)
    updatePackage.mutate({ serviceId: service.id, id: pkg.id, is_active: nextActive }, {
      onSuccess: () => toast.success(nextActive ? 'Paquete activado' : 'Paquete desactivado'),
      onError: err => onError(extractErrorMessage(err)),
    })
  }

  const pendingId = updatePackage.isPending ? updatePackage.variables?.id : undefined

  return (
    <div className="mt-3 rounded-lg border border-wa-border/70 p-2.5 dark:border-wa-border-dark/70">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-wa-muted dark:text-wa-muted-dark">
          <Package className="h-3.5 w-3.5" aria-hidden="true" />
          Paquetes · lo que se vende
        </p>
        {!adding && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)} aria-label={`Añadir paquete a ${service.name}`}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Añadir paquete
          </Button>
        )}
      </div>

      {packages.length === 0 && !adding && (
        <p className="mt-2 text-xs text-wa-muted dark:text-wa-muted-dark">
          Sin paquetes: el asistente IA no cotiza este servicio hasta que tenga al menos uno.
        </p>
      )}

      {packages.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {packages.map(pkg => {
            const draft = draftOf(pkg)
            const changed = Object.keys(changedFields(pkg, draft)).length > 0
            const pending = pendingId === pkg.id
            return (
              <li
                key={pkg.id}
                className={`grid grid-cols-[minmax(0,1fr)_4rem_6rem_auto] items-center gap-1.5 ${pkg.is_active ? '' : 'opacity-60'}`}
              >
                <Input
                  value={draft.name}
                  onChange={event => setDraftField(pkg, 'name', event.target.value)}
                  maxLength={80}
                  aria-label={`Nombre del paquete ${pkg.name} de ${service.name}`}
                  className="bg-white py-1 dark:bg-wa-panel-dark"
                />
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={draft.sessions}
                  onChange={event => setDraftField(pkg, 'sessions', event.target.value)}
                  aria-label={`Sesiones del paquete ${pkg.name} de ${service.name}`}
                  className="bg-white px-2 py-1 dark:bg-wa-panel-dark"
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={draft.price}
                  onChange={event => setDraftField(pkg, 'price', event.target.value)}
                  aria-label={`Precio del paquete ${pkg.name} de ${service.name}`}
                  className="bg-white px-2 py-1 dark:bg-wa-panel-dark"
                />
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleSave(pkg)}
                    disabled={!changed || pending}
                    aria-label={`Guardar paquete ${pkg.name} de ${service.name}`}
                  >
                    {pending && changed ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleToggle(pkg)}
                    disabled={pending}
                    aria-label={`${pkg.is_active ? 'Desactivar' : 'Activar'} paquete ${pkg.name} de ${service.name}`}
                  >
                    {pending && !changed
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      : pkg.is_active ? <X className="h-3.5 w-3.5" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {adding && (
        <form onSubmit={handleCreate} className="mt-2 grid grid-cols-[minmax(0,1fr)_4rem_6rem_auto] items-end gap-1.5">
          <label className="block min-w-0 text-xs text-wa-muted dark:text-wa-muted-dark">
            Nombre
            <Input
              value={newDraft.name}
              onChange={event => setNewDraft(current => ({ ...current, name: event.target.value }))}
              maxLength={80}
              placeholder="Ej. Pack x3"
              aria-label={`Nombre del nuevo paquete de ${service.name}`}
              className="mt-1 bg-white py-1 dark:bg-wa-panel-dark"
            />
          </label>
          <label className="block text-xs text-wa-muted dark:text-wa-muted-dark">
            Sesiones
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={newDraft.sessions}
              onChange={event => setNewDraft(current => ({ ...current, sessions: event.target.value }))}
              aria-label={`Sesiones del nuevo paquete de ${service.name}`}
              className="mt-1 bg-white px-2 py-1 dark:bg-wa-panel-dark"
            />
          </label>
          <label className="block text-xs text-wa-muted dark:text-wa-muted-dark">
            Precio
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={newDraft.price}
              onChange={event => setNewDraft(current => ({ ...current, price: event.target.value }))}
              placeholder="0.00"
              aria-label={`Precio del nuevo paquete de ${service.name}`}
              className="mt-1 bg-white px-2 py-1 dark:bg-wa-panel-dark"
            />
          </label>
          <div className="flex items-center gap-1">
            <Button type="submit" size="sm" className="h-8" disabled={createPackage.isPending} aria-label={`Guardar nuevo paquete de ${service.name}`}>
              {createPackage.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              Añadir
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => { setAdding(false); setNewDraft(EMPTY_DRAFT); onError(null) }}
              aria-label={`Cancelar nuevo paquete de ${service.name}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
