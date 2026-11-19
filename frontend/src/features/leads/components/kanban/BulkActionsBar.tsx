import { Loader2, Tag as TagIcon, X } from 'lucide-react'
import { Select } from '../../../../shared/ui/Input'
import type { LeadStageCatalog } from '../../domain/leadStageMeta'
import type { LeadStage } from '../../types'

interface BulkActionsBarProps {
  count: number
  catalog: LeadStageCatalog
  tags: readonly { id: number; name: string }[]
  isBusy: boolean
  error: string | null
  onMove: (stage: LeadStage) => void
  onTag: (tagId: number) => void
  onClear: () => void
}

export function BulkActionsBar({ count, catalog, tags, isBusy, error, onMove, onTag, onClear }: BulkActionsBarProps) {
  const noun = count === 1 ? 'lead' : 'leads'
  return (
    <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-wa-border bg-wa-field px-4 py-2.5 sm:px-6 dark:border-wa-border-dark dark:bg-wa-head-dark">
      <span className="mr-1 text-sm font-semibold text-wa-text dark:text-wa-text-dark" role="status">
        {count} seleccionado{count === 1 ? '' : 's'}
      </span>

      <Select
        value=""
        disabled={isBusy}
        aria-label={`Mover ${count} ${noun} a otra etapa`}
        onChange={(event) => {
          if (event.target.value) onMove(event.target.value)
        }}
        className="h-10 w-auto min-w-40 border-wa-border bg-wa-panel text-sm focus:ring-wa-primary-strong disabled:cursor-wait disabled:opacity-60 dark:border-wa-border-dark dark:bg-wa-panel-dark"
      >
        <option value="">Mover a...</option>
        {catalog.active.map((stage) => (
          <option key={stage.key} value={stage.key}>{stage.name}</option>
        ))}
      </Select>

      {tags.length > 0 && (
        <div className="flex items-center gap-1">
          <TagIcon className="h-4 w-4 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
          <Select
            value=""
            disabled={isBusy}
            aria-label={`Agregar etiqueta a ${count} ${noun}`}
            onChange={(event) => {
              if (event.target.value) onTag(Number(event.target.value))
            }}
            className="h-10 w-auto min-w-44 border-wa-border bg-wa-panel text-sm focus:ring-wa-primary-strong disabled:cursor-wait disabled:opacity-60 dark:border-wa-border-dark dark:bg-wa-panel-dark"
          >
            <option value="">Agregar etiqueta...</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>{tag.name}</option>
            ))}
          </Select>
        </div>
      )}

      {isBusy && <span className="inline-flex items-center gap-2 text-sm text-wa-muted dark:text-wa-muted-dark" role="status"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Aplicando cambios…</span>}
      {error && <span role="alert" className="text-sm text-red-700 dark:text-red-300">{error} La selección conserva los fallidos.</span>}

      <button
        type="button"
        onClick={onClear}
        className="ml-auto flex min-h-10 items-center gap-1 rounded-md px-3 text-sm font-medium text-wa-text hover:bg-wa-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong dark:text-wa-text-dark dark:hover:bg-wa-panel-dark"
      >
        <X className="h-4 w-4" aria-hidden="true" /> Cancelar selección
      </button>
    </div>
  )
}
