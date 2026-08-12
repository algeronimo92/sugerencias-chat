import { useEffect, useState } from 'react'
import { Check, FolderTree, Loader2, Plus, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { TemplateCategory } from '../types'
import {
  useCreateTemplateCategory,
  useTemplateCategories,
  useUpdateTemplateCategory,
} from '../hooks/useTemplateCategories'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'

export function TemplateCategoriesManagementPanel() {
  const { data: categories = [], isLoading, error: loadError } = useTemplateCategories(true)
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

  if (isLoading) return <p className="py-8 text-center text-sm text-wa-muted">Cargando categorías…</p>
  if (loadError) return <p className="py-8 text-center text-sm text-red-500">No se pudieron cargar las categorías.</p>

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-wa-primary-strong dark:text-wa-primary" />
          <h2 className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Categorías de plantillas</h2>
        </div>
        <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
          Ordenan las plantillas con nombres consistentes. Las categorías inactivas permanecen en las plantillas existentes.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-2 rounded-xl border border-wa-border bg-wa-hover p-3 dark:border-wa-border-dark dark:bg-wa-head-dark sm:flex-row sm:items-center">
        <input
          value={newName}
          onChange={event => setNewName(event.target.value)}
          maxLength={60}
          placeholder="Nombre de la nueva categoría"
          className="min-w-0 flex-1 rounded-lg border border-wa-border bg-white px-3 py-2 text-sm text-wa-text outline-none focus:ring-2 focus:ring-wa-primary/60 dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
        />
        <Button type="submit" disabled={!newName.trim() || createCategory.isPending} className="shrink-0">
          {createCategory.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Crear categoría
        </Button>
      </form>

      <div className="space-y-2">
        {categories.map(category => {
          const draft = drafts[category.id] ?? category.name
          const isActive = category.is_active !== false
          const changed = draft.trim() !== category.name
          const isThisPending = updateCategory.isPending && updateCategory.variables?.id === category.id
          return (
            <div key={category.id} className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center ${isActive ? 'border-wa-border dark:border-wa-border-dark' : 'border-dashed border-wa-border bg-wa-hover/70 opacity-70 dark:border-wa-border-dark dark:bg-wa-head-dark/60'}`}>
              <div className="min-w-0 flex-1">
                <input
                  value={draft}
                  onChange={event => setDrafts(current => ({ ...current, [category.id]: event.target.value }))}
                  maxLength={60}
                  aria-label={`Nombre de ${category.name}`}
                  className="w-full rounded-lg border border-wa-border bg-white px-3 py-1.5 text-sm text-wa-text outline-none focus:ring-2 focus:ring-wa-primary/60 dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
                />
                <p className="mt-1 text-[10px] text-wa-muted dark:text-wa-muted-dark">
                  Creada por {category.created_by_name ?? 'Sistema'}
                  {category.created_at ? ` · ${new Date(category.created_at).toLocaleDateString('es-PE')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => handleSave(category)} disabled={!changed || isThisPending} aria-label={`Guardar ${category.name}`}>
                  {isThisPending && changed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Guardar
                </Button>
                <button
                  type="button"
                  onClick={() => handleToggle(category)}
                  disabled={isThisPending}
                  aria-pressed={isActive}
                  title={isActive ? `Desactivar ${category.name}` : `Activar ${category.name}`}
                  className={`inline-flex h-7 min-w-24 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold shadow-sm outline-none transition-[color,background-color,border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-wa-primary/60 disabled:cursor-wait disabled:opacity-50 ${isActive ? 'border border-wa-primary bg-wa-primary text-white hover:border-wa-primary-strong hover:bg-wa-primary-strong dark:border-wa-primary dark:bg-wa-primary dark:text-white' : 'border border-wa-border bg-white text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark dark:hover:text-wa-text-dark'}`}
                >
                  {isThisPending && !changed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isActive ? <Check className="h-3.5 w-3.5" /> : null}
                  {isActive ? 'Activa' : 'Inactiva'}
                </button>
              </div>
            </div>
          )
        })}
        {categories.length === 0 && <p className="rounded-xl border border-dashed border-wa-border py-8 text-center text-sm text-wa-muted dark:border-wa-border-dark">Todavía no hay categorías.</p>}
      </div>

      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
    </div>
  )
}
