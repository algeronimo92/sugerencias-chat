import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../../shared/ui/Button'
import { Select } from '../../../../shared/ui/Input'
import { extractErrorMessage } from '../../../../shared/utils/errors'
import { stageOptions } from '../../../leads/public/leadStageMeta'
import { useLeadStageCatalog } from '../../../leads/public/useLeadStages'
import { TASK_TYPE_OPTIONS, isTaskType } from '../../../tasks/public/taskCatalog'
import { TEMPLATE_LIMITS, fieldId } from '../../domain/fieldLimits'
import { useCreateTemplateCategory } from '../../hooks/useTemplateCategories'
import type { TemplateEditorState } from '../../hooks/useTemplateEditor'
import type { TemplateCategory } from '../../types'
import { CountedInput, EditorSection, FieldErrors, FieldLabel } from './parts'

interface Props {
  editor: TemplateEditorState
  categories: TemplateCategory[]
}

/**
 * Cómo encuentra el equipo la plantilla: categoría, atajo y, en opciones
 * avanzadas, en qué chats aparece. Antes «Etapa del lead» y «Tipo de tarea»
 * estaban a la vista sin decir para qué servían.
 */
export function OrganizationSection({ editor, categories }: Props) {
  const { form, change, errorsFor } = editor
  const stageCatalog = useLeadStageCatalog()
  const createCategory = useCreateTemplateCategory()
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const categoryErrors = errorsFor('category')
  const shortcutErrors = errorsFor('shortcut')
  const narrowed = Boolean(form.stage || form.taskType)

  function addCategory() {
    const name = newCategory.trim()
    if (!name || createCategory.isPending) return
    setCategoryError(null)
    createCategory.mutate(name, {
      onSuccess: category => {
        change({ category: category.name })
        setNewCategory('')
        setAddingCategory(false)
        toast.success('Categoría creada y elegida')
      },
      onError: reason => setCategoryError(extractErrorMessage(reason)),
    })
  }

  return (
    <EditorSection title="Para encontrarla">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={fieldId('category')} required>Categoría del equipo</FieldLabel>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Select
                id={fieldId('category')}
                aria-invalid={categoryErrors.length > 0 || undefined}
                value={form.category}
                onChange={event => change({ category: event.target.value })}
              >
                <option value="" disabled>Elige una categoría</option>
                {form.category && !categories.some(category => category.name === form.category) && <option value={form.category}>{form.category} (inactiva)</option>}
                {categories.map(category => <option key={category.id} value={category.name}>{category.name}</option>)}
              </Select>
            </div>
            <Button variant="secondary" onClick={() => setAddingCategory(open => !open)} aria-expanded={addingCategory}>Nueva</Button>
          </div>
          {addingCategory && (
            <div className="mt-2 flex gap-2">
              <CountedInput
                autoFocus
                aria-label="Nombre de la categoría nueva"
                value={newCategory}
                max={TEMPLATE_LIMITS.category}
                placeholder="Nombre de la categoría"
                onChange={event => setNewCategory(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCategory() } }}
              />
              <Button onClick={addCategory} loading={createCategory.isPending} disabled={!newCategory.trim()}>Crear</Button>
            </div>
          )}
          <div className="mt-1.5"><FieldErrors messages={[...categoryErrors, ...(categoryError ? [categoryError] : [])]} /></div>
        </div>

        <div>
          <FieldLabel htmlFor={fieldId('shortcut')} optional>Atajo</FieldLabel>
          <CountedInput
            id={fieldId('shortcut')}
            aria-invalid={shortcutErrors.length > 0 || undefined}
            value={form.shortcut}
            max={TEMPLATE_LIMITS.shortcut}
            placeholder="aviso-cita"
            autoCapitalize="none"
            spellCheck={false}
            onChange={event => change({ shortcut: event.target.value })}
          />
          {shortcutErrors.length === 0 && <p className="mt-1.5 text-xs text-fg-muted">En el chat, escribe / y el atajo para traerla. Sin espacios.</p>}
          <div className="mt-1.5"><FieldErrors messages={shortcutErrors} /></div>
        </div>
      </div>

      <details className="group rounded-lg border border-line" open={narrowed || undefined}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2.5 outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-semibold text-fg">Opciones avanzadas</span>
            <span className="block text-xs text-fg-muted">En qué chats aparece. {narrowed ? 'Ahora está limitada.' : 'Ahora: en todos.'}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="grid gap-4 border-t border-line p-3 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="template-stage">Etapa del lead</FieldLabel>
            <Select id="template-stage" value={form.stage} onChange={event => { const value = event.target.value; change({ stage: value as typeof form.stage }) }}>
              <option value="">Cualquier etapa</option>
              {stageOptions(stageCatalog, form.stage || null).map(stage => <option key={stage.key} value={stage.key}>{stage.is_active ? stage.name : `${stage.name} (inactiva)`}</option>)}
            </Select>
            <p className="mt-1.5 text-xs text-fg-muted">Con una etapa elegida, la plantilla solo se ofrece en chats que están en esa etapa.</p>
          </div>
          <div>
            <FieldLabel htmlFor="template-task-type">Tipo de tarea</FieldLabel>
            <Select id="template-task-type" value={form.taskType} onChange={event => { const value = event.target.value; if (value === '' || isTaskType(value)) change({ taskType: value }) }}>
              <option value="">Cualquier tarea</option>
              {TASK_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
            {/* El dato se guarda pero nada lo lee todavía para filtrar ni
                sugerir: decirlo evita que alguien lo elija esperando un efecto. */}
            <p className="mt-1.5 text-xs text-fg-muted">Solo la clasifica: por ahora no cambia dónde aparece.</p>
          </div>
        </div>
      </details>
    </EditorSection>
  )
}
