import { Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { Checkbox } from '../../../../shared/ui/Checkbox'
import { Select } from '../../../../shared/ui/Input'
import { useTags } from '../../../catalogs/public/useTags'
import { useBulkAssignSeller, useBulkAssignTag, useBulkMoveStage } from '../../../leads/public/bulkActions'
import { LostReasonDialog } from '../../../leads/public/LostReasonDialog'
import { useLeadStageCatalog } from '../../../leads/public/useLeadStages'
import type { BulkActionResult, LeadStage } from '../../../leads/types'
import { useSellers } from '../../../platform/public/useUsers'

// Valor del selector para "quitar la vendedora": `""` ya es "elegí una opción".
const NO_SELLER = 'none'

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function describeFailure(action: string, failed: string[]) {
  if (failed.length === 0) return null
  return `${plural(failed.length, 'chat')} no se pud${failed.length === 1 ? 'o' : 'ieron'} ${action}. Siguen seleccionados.`
}

interface Props {
  selected: ReadonlySet<string>
  /** Los chats que la lista tiene cargados: "Seleccionar todos" marca estos. */
  visibleIds: readonly string[]
  onSelectionChange: (ids: Set<string>) => void
  onCancel: () => void
  isAdmin: boolean
}

/**
 * Cabecera de la lista en modo selección (doc 18 §6.3): reemplaza al
 * buscador y a los selectores mientras haya chats marcados. Mover de etapa,
 * etiquetar y asignar vendedora a varios a la vez. Lo que falla queda
 * seleccionado para reintentar, como en el Kanban.
 */
export function BulkActionsBar({ selected, visibleIds, onSelectionChange, onCancel, isAdmin }: Props) {
  const catalog = useLeadStageCatalog()
  const { data: tags = [] } = useTags()
  const { data: sellers = [] } = useSellers({ enabled: isAdmin })
  const moveStage = useBulkMoveStage()
  const assignTag = useBulkAssignTag()
  const assignSeller = useBulkAssignSeller()
  const [error, setError] = useState<string | null>(null)
  const [pendingLost, setPendingLost] = useState<LeadStage | null>(null)

  const count = selected.size
  const busy = moveStage.isPending || assignTag.isPending || assignSeller.isPending
  const allVisible = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const chatIds = Array.from(selected)

  function settle(action: string) {
    return {
      onSuccess: (result: BulkActionResult) => {
        setError(describeFailure(action, result.failed))
        onSelectionChange(new Set(result.failed))
      },
      onError: () => setError(`No se pudo ${action} la selección.`),
    }
  }

  function move(stage: LeadStage, razonPerdido?: string | null) {
    if (catalog.isLost(stage) && razonPerdido === undefined) {
      setPendingLost(stage)
      return
    }
    setError(null)
    moveStage.mutate({ chatIds, stage, razonPerdido }, settle('mover'))
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg bg-subtle p-2">
      <div className="flex items-center gap-2">
        <Checkbox
          aria-label={allVisible ? 'Quitar la selección' : 'Seleccionar todos los visibles'}
          checked={allVisible}
          onCheckedChange={(checked) => onSelectionChange(checked ? new Set(visibleIds) : new Set())}
        />
        <span className="min-w-0 flex-1 text-sm font-semibold text-fg" role="status">
          {count === 0 ? 'Elige chats' : `${plural(count, 'seleccionado')}`}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-8 items-center gap-1 rounded-lg px-2 text-sm font-medium text-fg-muted outline-none transition-colors hover:bg-selected hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" /> Cancelar
        </button>
      </div>

      {count > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Select
            value=""
            disabled={busy}
            aria-label={`Mover ${plural(count, 'chat')} a otra etapa`}
            onValueChange={(stage) => { if (stage) move(stage) }}
            className="h-9 min-h-9 py-1.5"
          >
            <option value="">Mover a…</option>
            {catalog.active.map((stage) => <option key={stage.key} value={stage.key}>{stage.name}</option>)}
          </Select>
          {tags.length > 0 && (
            <Select
              value=""
              disabled={busy}
              aria-label={`Agregar etiqueta a ${plural(count, 'chat')}`}
              onValueChange={(tagId) => {
                if (!tagId) return
                setError(null)
                assignTag.mutate({ chatIds, tagId: Number(tagId) }, settle('etiquetar'))
              }}
              className="h-9 min-h-9 py-1.5"
            >
              <option value="">Etiquetar…</option>
              {tags.map((tag) => <option key={tag.id} value={String(tag.id)}>{tag.name}</option>)}
            </Select>
          )}
          {/* Reasignar es del admin: el backend se lo niega a la vendedora. */}
          {isAdmin && (
            <Select
              value=""
              disabled={busy}
              aria-label={`Asignar vendedora a ${plural(count, 'chat')}`}
              onValueChange={(value) => {
                if (!value) return
                setError(null)
                assignSeller.mutate({ chatIds, sellerId: value === NO_SELLER ? null : Number(value) }, settle('asignar'))
              }}
              className="h-9 min-h-9 py-1.5 sm:col-span-2"
            >
              <option value="">Asignar a…</option>
              {sellers.map((seller) => <option key={seller.id} value={String(seller.id)}>{seller.name}</option>)}
              <option value={NO_SELLER}>Sin asignar</option>
            </Select>
          )}
        </div>
      )}

      {busy && (
        <span className="inline-flex items-center gap-2 text-sm text-fg-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Aplicando cambios…
        </span>
      )}
      {error && <span role="alert" className="text-sm text-danger-fg">{error}</span>}

      {pendingLost && (
        <LostReasonDialog
          count={count}
          stageName={catalog.label(pendingLost)}
          onCancel={() => setPendingLost(null)}
          onConfirm={(razon) => {
            const stage = pendingLost
            setPendingLost(null)
            move(stage, razon)
          }}
        />
      )}
    </div>
  )
}
