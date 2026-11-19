import { ArrowRightLeft, Loader2, Tag as TagIcon, X } from 'lucide-react'
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
  /** En la lista el conteo y "Cancelar" ya están arriba, en la fila de la
   *  etapa: la barra queda solo con las acciones. */
  showSummary?: boolean
}

const ACTION_CLASS =
  'h-10 w-full border-wa-border bg-wa-panel text-sm font-medium focus:ring-wa-primary-strong disabled:cursor-wait disabled:opacity-60 sm:w-48 dark:border-wa-border-dark dark:bg-wa-panel-dark'

/** Acciones sobre la selección, al pie del embudo como en la bandeja de chats:
 *  arriba quedan libres el buscador y el selector de vista. En el celular, el
 *  conteo y "Cancelar" van en una fila y las acciones debajo, a lo ancho. */
export function BulkActionsBar({ count, catalog, tags, isBusy, error, onMove, onTag, onClear, showSummary = true }: BulkActionsBarProps) {
  const noun = count === 1 ? 'lead' : 'leads'
  return (
    <div
      role="region"
      aria-label="Acciones sobre los leads seleccionados"
      className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-wa-border bg-wa-panel px-4 py-2.5 shadow-[0_-4px_12px_rgb(0_0_0/0.06)] sm:px-6 dark:border-wa-border-dark dark:bg-wa-panel-dark dark:shadow-[0_-4px_12px_rgb(0_0_0/0.35)]"
    >
      {showSummary && (
        <>
          <span className="shrink-0 text-sm font-semibold text-wa-text dark:text-wa-text-dark" role="status">
            {count} seleccionado{count === 1 ? '' : 's'}
          </span>

          <button
            type="button"
            onClick={onClear}
            className="ml-auto flex h-9 shrink-0 items-center gap-1 rounded-md px-2.5 text-sm font-medium text-wa-muted hover:bg-wa-hover hover:text-wa-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong sm:order-last sm:ml-0 dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark dark:hover:text-wa-text-dark"
          >
            <X className="h-4 w-4" aria-hidden="true" /> Cancelar
          </button>
        </>
      )}

      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <ArrowRightLeft className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
          <Select
            value=""
            disabled={isBusy}
            aria-label={`Mover ${count} ${noun} a otra etapa`}
            onChange={(event) => {
              if (event.target.value) onMove(event.target.value)
            }}
            className={`${ACTION_CLASS} pl-9`}
          >
            <option value="">Mover a…</option>
            {catalog.active.map((stage) => (
              <option key={stage.key} value={stage.key}>{stage.name}</option>
            ))}
          </Select>
        </div>

        {tags.length > 0 && (
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <TagIcon className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
            <Select
              value=""
              disabled={isBusy}
              aria-label={`Agregar etiqueta a ${count} ${noun}`}
              onChange={(event) => {
                if (event.target.value) onTag(Number(event.target.value))
              }}
              className={`${ACTION_CLASS} pl-9`}
            >
              <option value="">Etiquetar…</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </Select>
          </div>
        )}

        {isBusy && (
          <span className="hidden items-center gap-2 text-sm text-wa-muted sm:inline-flex dark:text-wa-muted-dark" role="status">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Aplicando cambios…
          </span>
        )}
      </div>

      {error && <p role="alert" className="w-full text-sm text-red-700 dark:text-red-300">{error} La selección conserva los fallidos.</p>}
    </div>
  )
}
