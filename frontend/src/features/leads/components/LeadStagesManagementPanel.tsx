import { AlertTriangle, ArrowDown, ArrowUp, Check, Columns3, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { Input, Select } from '../../../shared/ui/Input'
import { Skeleton } from '../../../shared/ui/Skeleton'
import { extractErrorMessage } from '../../../shared/utils/errors'
import {
LEAD_STAGE_COLORS,
LEAD_STAGE_KIND_HINTS,
LEAD_STAGE_KIND_LABELS,
STAGE_BADGE_CLASS,
stageColorStyle,
} from '../domain/leadStageMeta'
import {
useAdminLeadStages,
useCreateLeadStage,
useDeleteLeadStage,
useReorderLeadStages,
useUpdateLeadStage,
} from '../hooks/useLeadStages'
import type { LeadStageAdminDefinition, LeadStageKind } from '../types'

interface StageDraft {
  name: string
  color: string
  kind: LeadStageKind
  description: string
}

const KINDS: readonly LeadStageKind[] = ['open', 'won', 'lost']

function draftFrom(stage: LeadStageAdminDefinition): StageDraft {
  return { name: stage.name, color: stage.color, kind: stage.kind, description: stage.description ?? '' }
}

/** Solo lo que cambió: renombrar no debe reescribir el color ni al revés. */
function changedFields(stage: LeadStageAdminDefinition, draft: StageDraft) {
  const original = draftFrom(stage)
  const changes: Partial<StageDraft> = {}
  if (draft.name.trim() !== original.name) changes.name = draft.name.trim()
  if (draft.color !== original.color) changes.color = draft.color
  if (draft.kind !== original.kind) changes.kind = draft.kind
  if (draft.description.trim() !== original.description) changes.description = draft.description.trim()
  return changes
}

interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  label: string
}

/** Paleta cerrada (ver LEAD_STAGE_COLORS): garantiza que la insignia derivada
 *  se lea en tema claro y oscuro. */
function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {LEAD_STAGE_COLORS.map(color => {
        const selected = color.value === value
        return (
          <button
            key={color.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color.label}
            title={color.label}
            onClick={() => onChange(color.value)}
            style={{ backgroundColor: color.value }}
            className={`grid h-7 w-7 place-items-center rounded-full outline-none ring-offset-2 ring-offset-white transition-transform focus-visible:ring-2 focus-visible:ring-wa-primary-strong dark:ring-offset-wa-panel-dark ${
              selected ? 'ring-2 ring-wa-text dark:ring-wa-text-dark' : 'hover:scale-110'
            }`}
          >
            {selected && <Check className="h-3.5 w-3.5 text-white" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

function KindSelect({ value, onChange, id, label }: { value: LeadStageKind; onChange: (kind: LeadStageKind) => void; id?: string; label?: string }) {
  return (
    <Select
      id={id}
      aria-label={label}
      value={value}
      onChange={event => {
        const kind = KINDS.find(item => item === event.target.value)
        if (kind) onChange(kind)
      }}
      className="h-10 w-full border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-head-dark"
    >
      {KINDS.map(kind => <option key={kind} value={kind}>{LEAD_STAGE_KIND_LABELS[kind]}</option>)}
    </Select>
  )
}

export function LeadStagesManagementPanel() {
  const { data: stages = [], isLoading, error: loadError, refetch } = useAdminLeadStages()
  const createStage = useCreateLeadStage()
  const updateStage = useUpdateLeadStage()
  const reorderStages = useReorderLeadStages()
  const deleteStage = useDeleteLeadStage()
  const [newStage, setNewStage] = useState<StageDraft>({ name: '', color: LEAD_STAGE_COLORS[0].value, kind: 'open', description: '' })
  const [drafts, setDrafts] = useState<Record<string, StageDraft>>({})
  const [pendingDelete, setPendingDelete] = useState<LeadStageAdminDefinition | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDrafts(current => {
      const next = { ...current }
      let changed = false
      for (const stage of stages) {
        if (!(stage.key in next)) {
          next[stage.key] = draftFrom(stage)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [stages])

  function draftOf(stage: LeadStageAdminDefinition) {
    return drafts[stage.key] ?? draftFrom(stage)
  }

  function setDraft(stage: LeadStageAdminDefinition, values: Partial<StageDraft>) {
    setDrafts(current => ({ ...current, [stage.key]: { ...(current[stage.key] ?? draftFrom(stage)), ...values } }))
  }

  function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    const name = newStage.name.trim()
    if (!name || createStage.isPending) return
    setError(null)
    createStage.mutate({ ...newStage, name, description: newStage.description.trim() || null }, {
      onSuccess: () => {
        setNewStage(current => ({ ...current, name: '', description: '' }))
        toast.success('Etapa creada al final del embudo')
      },
      onError: err => setError(extractErrorMessage(err)),
    })
  }

  function handleSave(stage: LeadStageAdminDefinition) {
    const changes = changedFields(stage, draftOf(stage))
    if (changes.name === '') {
      setError('El nombre de la etapa es obligatorio')
      return
    }
    setError(null)
    updateStage.mutate({ key: stage.key, ...changes }, {
      onSuccess: updated => {
        setDrafts(current => ({ ...current, [stage.key]: draftFrom({ ...stage, ...updated }) }))
        toast.success('Etapa actualizada')
      },
      onError: err => setError(extractErrorMessage(err)),
    })
  }

  function handleToggle(stage: LeadStageAdminDefinition) {
    const nextActive = !stage.is_active
    setError(null)
    updateStage.mutate({ key: stage.key, is_active: nextActive }, {
      onSuccess: () => toast.success(nextActive ? 'Etapa activada' : 'Etapa desactivada'),
      onError: err => setError(extractErrorMessage(err)),
    })
  }

  function handleMove(index: number, offset: -1 | 1) {
    const keys = stages.map(stage => stage.key)
    const target = index + offset
    if (target < 0 || target >= keys.length) return
    const [moved] = keys.splice(index, 1)
    keys.splice(target, 0, moved)
    setError(null)
    reorderStages.mutate(keys, { onError: err => setError(extractErrorMessage(err)) })
  }

  function handleDelete(stage: LeadStageAdminDefinition) {
    setError(null)
    deleteStage.mutate(stage.key, {
      onSuccess: () => toast.success('Etapa eliminada'),
      onError: err => setError(extractErrorMessage(err)),
    })
  }

  const busyKey = updateStage.isPending ? updateStage.variables?.key : null

  return (
    <div>
      <div className="rounded-xl border border-wa-border bg-white p-4 sm:p-5 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <div className="flex items-center gap-2">
          <Columns3 className="h-5 w-5 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-wa-text dark:text-wa-text-dark">Administrar etapas del embudo</h2>
        </div>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
          Son las columnas del embudo y las etapas que usan los filtros, las automatizaciones y el analista IA. Renombrar una etapa no mueve a sus leads. Una etapa en uso no se elimina: desactívala para que deje de ofrecerse.
        </p>

        <form onSubmit={handleCreate} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <label htmlFor="new-stage-name" className="block text-sm font-medium text-wa-text dark:text-wa-text-dark">
            Nombre de la nueva etapa
            <Input
              id="new-stage-name"
              value={newStage.name}
              onChange={event => setNewStage(current => ({ ...current, name: event.target.value }))}
              maxLength={60}
              placeholder="Ej. Cita pagada"
              className="mt-2 h-10 border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-head-dark"
            />
          </label>
          <div className="text-sm font-medium text-wa-text dark:text-wa-text-dark">
            <label htmlFor="new-stage-kind">Tipo</label>
            <div className="mt-2"><KindSelect id="new-stage-kind" value={newStage.kind} onChange={kind => setNewStage(current => ({ ...current, kind }))} /></div>
          </div>
          <p className="-mt-1 text-xs text-wa-muted sm:col-span-2 dark:text-wa-muted-dark">{LEAD_STAGE_KIND_HINTS[newStage.kind]}</p>
          <label htmlFor="new-stage-description" className="block text-sm font-medium text-wa-text sm:col-span-2 dark:text-wa-text-dark">
            Cuándo un lead está en esta etapa <span className="font-normal text-wa-muted dark:text-wa-muted-dark">(opcional, lo usa el analista IA)</span>
            <Input
              id="new-stage-description"
              value={newStage.description}
              onChange={event => setNewStage(current => ({ ...current, description: event.target.value }))}
              maxLength={500}
              placeholder="Ej. Pagó la reserva de su primera cita"
              className="mt-2 h-10 border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-head-dark"
            />
          </label>
          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-medium text-wa-text dark:text-wa-text-dark">Color</p>
            <ColorPicker label="Color de la nueva etapa" value={newStage.color} onChange={color => setNewStage(current => ({ ...current, color }))} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={!newStage.name.trim() || createStage.isPending} className="h-10 bg-wa-primary-strong hover:bg-wa-primary-deep">
              {createStage.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Crear etapa
            </Button>
          </div>
        </form>
        {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      </div>

      <div className="mt-6">
        <h3 className="text-base font-semibold text-wa-text dark:text-wa-text-dark">Orden del embudo</h3>
        <p aria-live="polite" className="mt-0.5 text-sm text-wa-muted dark:text-wa-muted-dark">
          {isLoading ? 'Cargando…' : loadError ? 'Listado no disponible' : `${stages.length} ${stages.length === 1 ? 'etapa' : 'etapas'}, en el orden en que se muestran`}
        </p>
      </div>

      {isLoading ? (
        <ul className="mt-3 space-y-2" aria-label="Cargando etapas">
          {[0, 1, 2, 3].map(index => (
            <li key={index} className="rounded-xl border border-wa-border p-3 dark:border-wa-border-dark">
              <Skeleton className="h-8 w-full max-w-md" />
              <Skeleton className="mt-2 h-2.5 w-40" />
            </li>
          ))}
        </ul>
      ) : loadError ? (
        <div role="alert" className="mt-3 flex flex-col items-start gap-3 rounded-xl border border-wa-border bg-white px-5 py-6 dark:border-wa-border-dark dark:bg-wa-panel-dark">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">No pudimos cargar las etapas</p>
            <p className="mt-1 max-w-lg text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">{extractErrorMessage(loadError)} Prueba de nuevo; si sigue igual, avisa al equipo.</p>
          </div>
          <Button variant="secondary" size="sm" className="h-9" onClick={() => { void refetch() }}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Reintentar
          </Button>
        </div>
      ) : (
        <ol className="mt-3 space-y-2">
          {stages.map((stage, index) => {
            const draft = draftOf(stage)
            const changed = Object.keys(changedFields(stage, draft)).length > 0
            const pending = busyKey === stage.key
            const canDelete = !stage.is_system && stage.lead_count === 0
            return (
              <li
                key={stage.key}
                className={`rounded-xl border p-3 ${
                  stage.is_active
                    ? 'border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-panel-dark'
                    : 'border-dashed border-wa-border bg-wa-hover/70 dark:border-wa-border-dark dark:bg-wa-head-dark/60'
                }`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                  <div className="flex items-center gap-1 lg:flex-col lg:pt-1">
                    <Button variant="ghost" size="icon" className="h-9 w-9" disabled={index === 0 || reorderStages.isPending} onClick={() => handleMove(index, -1)} aria-label={`Subir ${stage.name}`}>
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-9 w-9" disabled={index === stages.length - 1 || reorderStages.isPending} onClick={() => handleMove(index, 1)} aria-label={`Bajar ${stage.name}`}>
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>

                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                      <Input
                        value={draft.name}
                        onChange={event => setDraft(stage, { name: event.target.value })}
                        maxLength={60}
                        aria-label={`Nombre de ${stage.name}`}
                        className="h-10 w-full bg-white dark:bg-wa-panel-dark"
                      />
                      {stage.is_system ? (
                        <p className="flex h-10 items-center text-xs text-wa-muted dark:text-wa-muted-dark">{LEAD_STAGE_KIND_LABELS.open} · etapa inicial</p>
                      ) : (
                        <KindSelect label={`Tipo de ${stage.name}`} value={draft.kind} onChange={kind => setDraft(stage, { kind })} />
                      )}
                    </div>
                    <Input
                      value={draft.description}
                      onChange={event => setDraft(stage, { description: event.target.value })}
                      maxLength={500}
                      placeholder="Cuándo un lead está en esta etapa (lo usa el analista IA)"
                      aria-label={`Criterio de ${stage.name}`}
                      className="h-10 w-full bg-white dark:bg-wa-panel-dark"
                    />
                    <ColorPicker label={`Color de ${stage.name}`} value={draft.color} onChange={color => setDraft(stage, { color })} />
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-wa-muted dark:text-wa-muted-dark">
                      <span style={stageColorStyle(draft.color)} className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${STAGE_BADGE_CLASS}`}>{draft.name.trim() || stage.name}</span>
                      <span>{stage.lead_count} {stage.lead_count === 1 ? 'lead' : 'leads'}</span>
                      <span aria-hidden="true">·</span>
                      <span>Clave <code className="font-mono">{stage.key}</code></span>
                      {!stage.is_active && <span className="font-semibold">· Desactivada</span>}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-stretch">
                    <Button variant="secondary" size="sm" className="h-11 sm:h-9" onClick={() => handleSave(stage)} disabled={!changed || pending} aria-label={`Guardar ${stage.name}`}>
                      {pending && changed ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
                      Guardar
                    </Button>
                    {!stage.is_system && (
                      <Button variant="secondary" size="sm" className="h-11 sm:h-9" onClick={() => handleToggle(stage)} disabled={pending} aria-label={`${stage.is_active ? 'Desactivar' : 'Activar'} ${stage.name}`}>
                        {stage.is_active ? 'Desactivar' : 'Activar'}
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-11 text-red-700 hover:text-red-800 sm:h-9 dark:text-red-300 dark:hover:text-red-200"
                        onClick={() => setPendingDelete(stage)}
                        disabled={deleteStage.isPending}
                        aria-label={`Eliminar ${stage.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Eliminar
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={open => { if (!open) setPendingDelete(null) }}
        title={`Eliminar la etapa ${pendingDelete?.name ?? ''}`}
        description="No tiene leads. Si alguna automatización o plantilla la usa, no se podrá eliminar: en ese caso desactívala."
        confirmLabel="Eliminar"
        onConfirm={() => { if (pendingDelete) handleDelete(pendingDelete) }}
      />
    </div>
  )
}
