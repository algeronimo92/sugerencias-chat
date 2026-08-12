import { useEffect, useState } from 'react'
import { Check, Loader2, Plus, Save, Tags } from 'lucide-react'
import { toast } from 'sonner'
import type { Tag } from '../types'
import { useCreateTag, useTags, useUpdateTag } from '../hooks/useLeadMeta'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'

interface TagDraft {
  name: string
  color: string
}

export function TagsManagementPanel() {
  const { data: tags = [], isLoading, error: loadError } = useTags(true)
  const createTag = useCreateTag()
  const updateTag = useUpdateTag()
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#16a34a')
  const [drafts, setDrafts] = useState<Record<number, TagDraft>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDrafts(current => {
      const next = { ...current }
      let changed = false
      for (const tag of tags) {
        if (!next[tag.id]) {
          next[tag.id] = { name: tag.name, color: tag.color }
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [tags])

  function setDraft(tag: Tag, values: Partial<TagDraft>) {
    setDrafts(current => {
      const existing = current[tag.id] ?? { name: tag.name, color: tag.color }
      return { ...current, [tag.id]: { ...existing, ...values } }
    })
  }

  function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    const name = newName.trim()
    if (!name || createTag.isPending) return
    setError(null)
    createTag.mutate({ name, color: newColor }, {
      onSuccess: () => {
        setNewName('')
        toast.success('Etiqueta creada')
      },
      onError: err => setError(extractErrorMessage(err)),
    })
  }

  function handleSave(tag: Tag) {
    const draft = drafts[tag.id] ?? { name: tag.name, color: tag.color }
    const name = draft.name.trim()
    if (!name) {
      setError('El nombre de la etiqueta es obligatorio')
      return
    }
    setError(null)
    updateTag.mutate({ id: tag.id, name, color: draft.color }, {
      onSuccess: () => toast.success('Etiqueta actualizada'),
      onError: err => setError(extractErrorMessage(err)),
    })
  }

  function handleToggle(tag: Tag) {
    const nextActive = tag.is_active === false
    setError(null)
    updateTag.mutate({ id: tag.id, is_active: nextActive }, {
      onSuccess: () => toast.success(nextActive ? 'Etiqueta activada' : 'Etiqueta desactivada'),
      onError: err => setError(extractErrorMessage(err)),
    })
  }

  if (isLoading) return <p className="py-8 text-center text-sm text-wa-muted">Cargando etiquetas…</p>
  if (loadError) return <p className="py-8 text-center text-sm text-red-500">No se pudieron cargar las etiquetas.</p>

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Tags className="h-4 w-4 text-wa-primary-strong dark:text-wa-primary" />
          <h3 className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Administrar etiquetas</h3>
        </div>
        <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
          Define nombres y colores consistentes. Una etiqueta desactivada permanece en los leads existentes, pero no se puede volver a asignar.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-2 rounded-xl border border-wa-border bg-wa-hover p-3 dark:border-wa-border-dark dark:bg-wa-head-dark sm:flex-row sm:items-center">
        <input
          type="color"
          value={newColor}
          onChange={event => setNewColor(event.target.value)}
          aria-label="Color de la nueva etiqueta"
          className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0 [&::-moz-color-swatch]:rounded-lg [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:rounded-lg [&::-webkit-color-swatch-wrapper]:p-0"
        />
        <input
          value={newName}
          onChange={event => setNewName(event.target.value)}
          maxLength={80}
          placeholder="Nombre de la nueva etiqueta"
          className="min-w-0 flex-1 rounded-lg border border-wa-border bg-white px-3 py-2 text-sm text-wa-text outline-none focus:ring-2 focus:ring-wa-primary/60 dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
        />
        <Button type="submit" disabled={!newName.trim() || createTag.isPending} className="shrink-0">
          {createTag.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Crear etiqueta
        </Button>
      </form>

      <div className="space-y-2">
        {tags.map(tag => {
          const draft = drafts[tag.id] ?? { name: tag.name, color: tag.color }
          const isActive = tag.is_active !== false
          const changed = draft.name.trim() !== tag.name || draft.color !== tag.color
          const isThisPending = updateTag.isPending && updateTag.variables?.id === tag.id
          return (
            <div key={tag.id} className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center ${isActive ? 'border-wa-border dark:border-wa-border-dark' : 'border-dashed border-wa-border bg-wa-hover/70 opacity-70 dark:border-wa-border-dark dark:bg-wa-head-dark/60'}`}>
              <input
                type="color"
                value={draft.color}
                onChange={event => setDraft(tag, { color: event.target.value })}
                aria-label={`Color de ${tag.name}`}
                className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0 [&::-moz-color-swatch]:rounded-lg [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:rounded-lg [&::-webkit-color-swatch-wrapper]:p-0"
              />
              <div className="min-w-0 flex-1">
                <input
                  value={draft.name}
                  onChange={event => setDraft(tag, { name: event.target.value })}
                  maxLength={80}
                  aria-label={`Nombre de ${tag.name}`}
                  className="w-full rounded-lg border border-wa-border bg-white px-3 py-1.5 text-sm text-wa-text outline-none focus:ring-2 focus:ring-wa-primary/60 dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
                />
                <p className="mt-1 text-[10px] text-wa-muted dark:text-wa-muted-dark">
                  Creada por {tag.created_by_name ?? 'Sistema'}
                  {tag.created_at ? ` · ${new Date(tag.created_at).toLocaleDateString('es-PE')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleSave(tag)}
                  disabled={!changed || isThisPending}
                  aria-label={`Guardar ${tag.name}`}
                >
                  {isThisPending && changed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Guardar
                </Button>
                <button
                  type="button"
                  onClick={() => handleToggle(tag)}
                  disabled={isThisPending}
                  aria-pressed={isActive}
                  title={isActive ? `Desactivar ${tag.name}` : `Activar ${tag.name}`}
                  className={`inline-flex h-7 min-w-24 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold shadow-sm outline-none transition-[color,background-color,border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-wa-primary/60 disabled:cursor-wait disabled:opacity-50 ${isActive ? 'border border-wa-primary bg-wa-primary text-white hover:border-wa-primary-strong hover:bg-wa-primary-strong dark:border-wa-primary dark:bg-wa-primary dark:text-white' : 'border border-wa-border bg-white text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark dark:hover:text-wa-text-dark'}`}
                >
                  {isThisPending && !changed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isActive ? <Check className="h-3.5 w-3.5" /> : null}
                  {isActive ? 'Activa' : 'Inactiva'}
                </button>
              </div>
            </div>
          )
        })}
        {tags.length === 0 && <p className="rounded-xl border border-dashed border-wa-border py-8 text-center text-sm text-wa-muted dark:border-wa-border-dark">Todavía no hay etiquetas.</p>}
      </div>

      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
    </div>
  )
}
