import { ArrowRightLeft, ChevronUp, Loader2, Tag, UserRound, X, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Checkbox } from '../../../../shared/ui/Checkbox'
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../../../../shared/ui/DropdownMenu'
import { useTags } from '../../../catalogs/public/useTags'
import { useBulkAssignSeller, useBulkAssignTag, useBulkMoveStage } from '../../../leads/public/bulkActions'
import { LostReasonDialog } from '../../../leads/public/LostReasonDialog'
import { useLeadStageCatalog } from '../../../leads/public/useLeadStages'
import type { BulkActionResult, LeadStage } from '../../../leads/types'
import { useSellers } from '../../../platform/public/useUsers'

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function describeFailure(action: string, failed: string[]) {
  if (failed.length === 0) return null
  return `${plural(failed.length, 'chat')} no se pud${failed.length === 1 ? 'o' : 'ieron'} ${action}. Siguen seleccionados.`
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
 * chat; ahora viven en la barra del pie (BulkActionsFooter).
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

function ActionMenu({ icon: Icon, label, ariaLabel, disabled, children }: { icon: LucideIcon; label: string; ariaLabel: string; disabled: boolean; children: ReactNode }) {
  return (
    <DropdownMenu
      side="top"
      align="start"
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line-control bg-surface px-2 text-sm font-medium text-fg outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60 data-[state=open]:bg-selected"
        >
          <Icon className="h-4 w-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden="true" />
          <span className="truncate">{label}</span>
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
        </button>
      }
    >
      {children}
    </DropdownMenu>
  )
}

interface FooterProps {
  selected: ReadonlySet<string>
  onSelectionChange: (ids: Set<string>) => void
  isAdmin: boolean
}

/**
 * Acciones masivas al pie de la lista (como Gmail o Manychat): mover de
 * etapa, etiquetar y, para el admin, asignar vendedora. Aparece al marcar el
 * primer chat sin mover la lista, y cada acción abre su menú hacia arriba.
 * Lo que falla queda seleccionado para reintentar, como en el Kanban.
 */
export function BulkActionsFooter({ selected, onSelectionChange, isAdmin }: FooterProps) {
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

  function assign(sellerId: number | null) {
    setError(null)
    assignSeller.mutate({ chatIds, sellerId }, settle('asignar'))
  }

  if (count === 0 && !error) return null

  return (
    <div className="shrink-0 border-t border-line bg-surface-raised px-3 py-2.5 pb-safe-3">
      {(busy || error) && (
        <p className="mb-2 flex items-center gap-2 text-sm" role={error ? 'alert' : 'status'}>
          {busy ? (
            <span className="inline-flex items-center gap-2 text-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Aplicando cambios…
            </span>
          ) : (
            <span className="text-danger-fg">{error}</span>
          )}
        </p>
      )}
      {count > 0 && (
        <div className="flex gap-2">
          <ActionMenu icon={ArrowRightLeft} label="Mover" ariaLabel={`Mover ${plural(count, 'chat')} a otra etapa`} disabled={busy}>
            {catalog.active.map((stage) => (
              <DropdownMenuItem key={stage.key} onSelect={() => move(stage.key)}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden="true" />
                {stage.name}
              </DropdownMenuItem>
            ))}
          </ActionMenu>
          {tags.length > 0 && (
            <ActionMenu icon={Tag} label="Etiquetar" ariaLabel={`Agregar etiqueta a ${plural(count, 'chat')}`} disabled={busy}>
              {tags.map((tag) => (
                <DropdownMenuItem
                  key={tag.id}
                  onSelect={() => {
                    setError(null)
                    assignTag.mutate({ chatIds, tagId: tag.id }, settle('etiquetar'))
                  }}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                  {tag.name}
                </DropdownMenuItem>
              ))}
            </ActionMenu>
          )}
          {/* Reasignar es del admin: el backend se lo niega a la vendedora. */}
          {isAdmin && (
            <ActionMenu icon={UserRound} label="Asignar" ariaLabel={`Asignar vendedora a ${plural(count, 'chat')}`} disabled={busy}>
              {sellers.map((seller) => (
                <DropdownMenuItem key={seller.id} onSelect={() => assign(seller.id)}>{seller.name}</DropdownMenuItem>
              ))}
              {sellers.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => assign(null)}>Sin asignar</DropdownMenuItem>
            </ActionMenu>
          )}
        </div>
      )}

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
