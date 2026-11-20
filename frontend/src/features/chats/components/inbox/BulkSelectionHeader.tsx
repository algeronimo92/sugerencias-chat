import { X } from 'lucide-react'
import { Checkbox } from '../../../../shared/ui/Checkbox'

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

interface HeaderProps {
  selected: ReadonlySet<string>
  /** Los chats que la lista tiene cargados: "Seleccionar todos" marca estos. */
  visibleIds: readonly string[]
  onSelectionChange: (ids: Set<string>) => void
  onCancel: () => void
}

/**
 * Cabecera de la lista en modo selección: una sola fila, de la misma altura
 * que la de estado y orden que reemplaza. Antes las acciones aparecían acá
 * apiladas y empujaban la lista ~150 px hacia abajo justo al marcar el primer
 * chat; ahora viven en la barra del pie (BulkActionsFooter, de leads).
 */
export function BulkSelectionHeader({ selected, visibleIds, onSelectionChange, onCancel }: HeaderProps) {
  const count = selected.size
  const allVisible = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  return (
    <div className="mt-2 flex h-9 items-center gap-2 px-1">
      <Checkbox
        aria-label={allVisible ? 'Quitar la selección' : 'Seleccionar todos los visibles'}
        checked={allVisible}
        onCheckedChange={(checked) => onSelectionChange(checked ? new Set(visibleIds) : new Set())}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg" role="status">
        {count === 0 ? 'Toca los chats para elegirlos' : plural(count, 'seleccionado')}
      </span>
      <button
        type="button"
        onClick={onCancel}
        className="flex h-8 items-center gap-1 rounded-lg px-2 text-sm font-medium text-fg-muted outline-none transition-colors hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden="true" /> Cancelar
      </button>
    </div>
  )
}
