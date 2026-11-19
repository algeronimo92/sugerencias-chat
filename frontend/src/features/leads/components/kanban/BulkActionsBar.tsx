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
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <span className="mr-1 shrink-0 text-sm font-semibold text-wa-text dark:text-wa-text-dark" role="status">
        {count} seleccionado{count === 1 ? '' : 's'}
      </span>

      <Select
        value=""
        disabled={isBusy}
        aria-label={`Mover ${count} ${noun} a otra etapa`}
        onChange={(event) => {
          if (event.target.value) onMove(event.target.value)
        }}
        className="h-9 w-auto min-w-0 flex-1 sm:min-w-40 sm:flex-none border-wa-border bg-wa-panel text-sm focus:ring-wa-primary-strong disabled:cursor-wait disabled:opacity-60 dark:border-wa-border-dark dark:bg-wa-panel-dark"
      >
        <option value="">Mover a...</option>
        {catalog.active.map((stage) => (
          <option key={stage.key} value={stage.key}>{stage.name}</option>
        ))}
      </Select>

      {tags.length > 0 && (
        <div className="order-last flex w-full items-center gap-1 sm:order-none sm:w-auto">
          <TagIcon className="h-4 w-4 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
          <Select
            value=""
            disabled={isBusy}
            aria-label={`Agregar etiqueta a ${count} ${noun}`}
            onChange={(event) => {
              if (event.target.value) onTag(Number(event.target.value))
            }}
            className="h-9 w-auto min-w-0 flex-1 sm:min-w-44 sm:flex-none border-wa-border bg-wa-panel text-sm focus:ring-wa-primary-strong disabled:cursor-wait disabled:opacity-60 dark:border-wa-border-dark dark:bg-wa-panel-dark"
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
        title="Cancelar selección"
        className="ml-auto flex h-9 shrink-0 items-center gap-1 rounded-md px-2.5 sm:px-3 text-sm font-medium text-wa-text hover:bg-wa-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong dark:text-wa-text-dark dark:hover:bg-wa-panel-dark"
      >
        <X className="h-4 w-4" aria-hidden="true" />
        {/* En el celular basta la X: el texto partía la barra en dos filas. */}
        <span className="sr-only sm:not-sr-only">Cancelar selección</span>
      </button>
    </div>
  )
}
