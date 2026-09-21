import { useEffect, useState } from 'react'
import { Loader2, Plus, Tags } from 'lucide-react'
import { toast } from 'sonner'
import type { Tag } from '../types'
import { useCreateTag, useTags, useUpdateTag } from '../hooks/useLeadMeta'
import { extractErrorMessage } from '../utils/errors'
import { CatalogPanel } from './CatalogPanel'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

interface TagDraft {
  name: string
  color: string
}

const colorInputClass =
  'shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0 [&::-moz-color-swatch]:rounded-lg [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:rounded-lg [&::-webkit-color-swatch-wrapper]:p-0'

export function TagsManagementPanel() {
  const { data: tags = [], isLoading, error: loadError, refetch } = useTags(true)
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

  return (
    <CatalogPanel
      icon={Tags}
      title="Administrar etiquetas"
      description="Define nombres y colores consistentes. Una etiqueta desactivada permanece en los leads existentes, pero no se puede volver a asignar."
      items={tags}
      getId={tag => tag.id}
      getName={tag => tag.name}
      isLoading={isLoading}
      error={loadError}
      onRetry={() => { void refetch() }}
      loadErrorTitle="No pudimos cargar las etiquetas"
      searchPlaceholder="Buscar etiqueta"
      singularNoun="etiqueta"
      pluralNoun="etiquetas"
      emptyTitle="Todavía no hay etiquetas"
      emptyDescription="Añade una etiqueta para organizar y filtrar tus leads."
      isActive={tag => tag.is_active !== false}
      hasChanges={tag => {
        const draft = drafts[tag.id] ?? { name: tag.name, color: tag.color }
        return draft.name.trim() !== tag.name || draft.color !== tag.color
      }}
      isPending={tag => updateTag.isPending && updateTag.variables?.id === tag.id}
      onSave={handleSave}
      onToggle={handleToggle}
      formError={error}
      createForm={
        <form onSubmit={handleCreate} className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
          <label htmlFor="new-tag-color" className="text-sm font-medium text-wa-text dark:text-wa-text-dark">
            Color
            <input
              id="new-tag-color"
              type="color"
              value={newColor}
              onChange={event => setNewColor(event.target.value)}
              className={`mt-2 block h-10 w-11 ${colorInputClass}`}
            />
          </label>
          <label htmlFor="new-tag-name" className="block min-w-0 flex-1 text-sm font-medium text-wa-text dark:text-wa-text-dark">
            Nombre de la nueva etiqueta
            <Input
              id="new-tag-name"
              value={newName}
              onChange={event => setNewName(event.target.value)}
              maxLength={80}
              placeholder="Ej. Seguimiento"
              className="mt-2 h-10 border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-head-dark"
            />
          </label>
          <Button type="submit" disabled={!newName.trim() || createTag.isPending} className="h-10 shrink-0 bg-wa-primary-strong hover:bg-wa-primary-deep">
            {createTag.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Crear etiqueta
          </Button>
        </form>
      }
      renderFields={tag => {
        const draft = drafts[tag.id] ?? { name: tag.name, color: tag.color }
        return (
          <>
            <input
              type="color"
              value={draft.color}
              onChange={event => setDraft(tag, { color: event.target.value })}
              aria-label={`Color de ${tag.name}`}
              className={`h-10 w-11 ${colorInputClass}`}
            />
            <div className="min-w-0 flex-1">
              <Input
                value={draft.name}
                onChange={event => setDraft(tag, { name: event.target.value })}
                maxLength={80}
                aria-label={`Nombre de ${tag.name}`}
                className="w-full bg-white py-1.5 dark:bg-wa-panel-dark"
              />
              <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
                Creada por {tag.created_by_name ?? 'Sistema'}
                {tag.created_at ? ` · ${new Date(tag.created_at).toLocaleDateString('es-PE')}` : ''}
              </p>
            </div>
          </>
        )
      }}
    />
  )
}
