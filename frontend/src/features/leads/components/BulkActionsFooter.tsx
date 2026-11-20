import { ArrowRightLeft, ChevronUp, Loader2, Tag, UserRound, X, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../../../shared/ui/DropdownMenu'
import { useTags } from '../../catalogs/public/useTags'
import { useSellers } from '../../platform/public/useUsers'
import { useLeadStageCatalog } from '../hooks/useLeadStages'
import { useBulkAssignSeller, useBulkAssignTag, useBulkMoveStage } from '../kanban-queries'
import type { BulkActionResult, LeadStage } from '../types'
import { LostReasonDialog } from './LostReasonDialog'

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function describeFailure(count: number, noun: string, action: string) {
  return `${plural(count, noun)} no se pud${count === 1 ? 'o' : 'ieron'} ${action}. Siguen seleccionados.`
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

interface Props {
  selected: ReadonlySet<string>
  onSelectionChange: (ids: Set<string>) => void
  isAdmin: boolean
  /** Cómo se llaman las filas en los textos: "chat" en la bandeja, "lead"
   * en el embudo. */
  noun?: 'chat' | 'lead'
  /** Con esto la barra muestra también el conteo y "Cancelar": para las
   * vistas que no los tienen arriba (el tablero del embudo). */
  onCancel?: () => void
}

/**
 * Acciones masivas al pie de una lista (como Gmail o Manychat): mover de
 * etapa, etiquetar y, para el admin, asignar vendedora. Es la misma en la
 * bandeja de chats y en el embudo: antes el embudo tenía una propia, con
 * selects nativos y sin asignar. Aparece al marcar la primera fila sin mover
 * la lista, cada acción abre su menú hacia arriba y lo que falla queda
 * seleccionado para reintentar.
 */
export function BulkActionsFooter({ selected, onSelectionChange, isAdmin, noun = 'chat', onCancel }: Props) {
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
  const rows = plural(count, noun)

  function settle(action: string) {
    return {
      onSuccess: (result: BulkActionResult) => {
        setError(result.failed.length > 0 ? describeFailure(result.failed.length, noun, action) : null)
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
    <div
      role="region"
      aria-label={`Acciones sobre los ${noun}s seleccionados`}
      className="shrink-0 border-t border-line bg-surface-raised px-3 py-2.5 pb-safe-3"
    >
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {onCancel && count > 0 && (
          <>
            <span className="shrink-0 text-sm font-semibold text-fg" role="status">{plural(count, 'seleccionado')}</span>
            <button
              type="button"
              onClick={onCancel}
              className="ml-auto flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-medium text-fg-muted outline-none transition-colors hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring sm:order-last sm:ml-0"
            >
              <X className="h-4 w-4" aria-hidden="true" /> Cancelar
            </button>
          </>
        )}
        {count > 0 && (
          // En una lista angosta (la bandeja) las acciones llenan el ancho; en
          // el embudo, a lo ancho de la pantalla, se topan para no estirarse.
          <div className="flex w-full min-w-0 gap-2 sm:w-auto sm:max-w-xl sm:flex-1">
            <ActionMenu icon={ArrowRightLeft} label="Mover" ariaLabel={`Mover ${rows} a otra etapa`} disabled={busy}>
              {catalog.active.map((stage) => (
                <DropdownMenuItem key={stage.key} onSelect={() => move(stage.key)}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden="true" />
                  {stage.name}
                </DropdownMenuItem>
              ))}
            </ActionMenu>
            {tags.length > 0 && (
              <ActionMenu icon={Tag} label="Etiquetar" ariaLabel={`Agregar etiqueta a ${rows}`} disabled={busy}>
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
              <ActionMenu icon={UserRound} label="Asignar" ariaLabel={`Asignar vendedora a ${rows}`} disabled={busy}>
                {sellers.map((seller) => (
                  <DropdownMenuItem key={seller.id} onSelect={() => assign(seller.id)}>{seller.name}</DropdownMenuItem>
                ))}
                {sellers.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={() => assign(null)}>Sin asignar</DropdownMenuItem>
              </ActionMenu>
            )}
          </div>
        )}
      </div>

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
