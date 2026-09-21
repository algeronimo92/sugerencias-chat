import { useEffect, useState } from 'react'
import { FolderTree, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { TemplateCategory } from '../types'
import {
  useCreateTemplateCategory,
  useTemplateCategories,
  useUpdateTemplateCategory,
} from '../hooks/useTemplateCategories'
import { extractErrorMessage } from '../utils/errors'
import { CatalogPanel } from './CatalogPanel'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

export function TemplateCategoriesManagementPanel() {
  const { data: categories = [], isLoading, error: loadError, refetch } = useTemplateCategories(true)
  const createCategory = useCreateTemplateCategory()
  const updateCategory = useUpdateTemplateCategory()
  const [newName, setNewName] = useState('')
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDrafts(current => {
      const next = { ...current }
      let changed = false
      for (const category of categories) {
        if (!(category.id in next)) {
          next[category.id] = category.name
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [categories])

  function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    const name = newName.trim()
    if (!name || createCategory.isPending) return
    setError(null)
    createCategory.mutate(name, {
      onSuccess: () => {
        setNewName('')
        toast.success('Categoría creada')
      },
      onError: reason => setError(extractErrorMessage(reason)),
    })
  }

  function handleSave(category: TemplateCategory) {
    const name = (drafts[category.id] ?? category.name).trim()
    if (!name) {
      setError('El nombre de la categoría es obligatorio')
      return
    }
    setError(null)
    updateCategory.mutate({ id: category.id, name }, {
      onSuccess: () => toast.success('Categoría actualizada'),
      onError: reason => setError(extractErrorMessage(reason)),
    })
  }

  function handleToggle(category: TemplateCategory) {
    const nextActive = category.is_active === false
    setError(null)
    updateCategory.mutate({ id: category.id, is_active: nextActive }, {
      onSuccess: () => toast.success(nextActive ? 'Categoría activada' : 'Categoría desactivada'),
      onError: reason => setError(extractErrorMessage(reason)),
    })
  }

  return (
    <CatalogPanel
      icon={FolderTree}
      title="Categorías de plantillas"
      description="Ordenan las plantillas con nombres consistentes. Las categorías inactivas permanecen en las plantillas existentes."
      items={categories}
      getId={category => category.id}
      getName={category => category.name}
      isLoading={isLoading}
      error={loadError}
      onRetry={() => { void refetch() }}
      loadErrorTitle="No pudimos cargar las categorías"
      searchPlaceholder="Buscar categoría"
      singularNoun="categoría"
      pluralNoun="categorías"
      emptyTitle="Todavía no hay categorías"
      emptyDescription="Añade una categoría para ordenar las plantillas de tu equipo."
      isActive={category => category.is_active !== false}
      hasChanges={category => (drafts[category.id] ?? category.name).trim() !== category.name}
      isPending={category => updateCategory.isPending && updateCategory.variables?.id === category.id}
      onSave={handleSave}
      onToggle={handleToggle}
      formError={error}
      createForm={
        <form onSubmit={handleCreate} className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
          <label htmlFor="new-template-category-name" className="block min-w-0 flex-1 text-sm font-medium text-wa-text dark:text-wa-text-dark">
            Nombre de la nueva categoría
            <Input
              id="new-template-category-name"
              value={newName}
              onChange={event => setNewName(event.target.value)}
              maxLength={60}
              placeholder="Ej. Promociones"
              className="mt-2 h-10 border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-head-dark"
            />
          </label>
          <Button type="submit" disabled={!newName.trim() || createCategory.isPending} className="h-10 shrink-0 bg-wa-primary-strong hover:bg-wa-primary-deep">
            {createCategory.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Crear categoría
          </Button>
        </form>
      }
      renderFields={category => (
        <div className="min-w-0 flex-1">
          <Input
            value={drafts[category.id] ?? category.name}
            onChange={event => setDrafts(current => ({ ...current, [category.id]: event.target.value }))}
            maxLength={60}
            aria-label={`Nombre de ${category.name}`}
            className="w-full bg-white py-1.5 dark:bg-wa-panel-dark"
          />
          <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
            Creada por {category.created_by_name ?? 'Sistema'}
            {category.created_at ? ` · ${new Date(category.created_at).toLocaleDateString('es-PE')}` : ''}
          </p>
        </div>
      )}
    />
  )
}
