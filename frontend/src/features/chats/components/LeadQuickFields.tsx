import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../../../shared/ui/DropdownMenu'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useUpdateLead } from '../../leads/public/queries'
import { LostReasonDialog } from '../../leads/public/LostReasonDialog'
import { useMoveLeadStage } from '../../leads/public/stageActions'
import { useLeadStageCatalog } from '../../leads/public/useLeadStages'
import type { Chat, LeadStage } from '../../leads/types'
import { useSellers } from '../../platform/public/useUsers'

const triggerClass =
  'flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-fg-muted outline-none transition-colors hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 data-[state=open]:bg-selected data-[state=open]:text-fg'

interface Props {
  chat: Chat
  isAdmin: boolean
}

/**
 * Etapa y vendedora como selectores en la cabecera del chat (doc 18 §6.3):
 * la vendedora mueve la etapa sin ir a la ficha, que es lo que más hace
 * durante una conversación. Reasignar es del admin: para el resto la
 * vendedora es solo texto (el backend se lo niega).
 */
export function LeadQuickFields({ chat, isAdmin }: Props) {
  const catalog = useLeadStageCatalog()
  const stage = catalog.get(chat.stage)
  const moveStage = useMoveLeadStage()
  const { mutate: updateLead, isPending: isAssigning } = useUpdateLead(chat.chat_id)
  const { data: sellers = [] } = useSellers({ enabled: isAdmin })
  const [pendingLost, setPendingLost] = useState<LeadStage | null>(null)

  function move(next: LeadStage, razonPerdido?: string | null) {
    if (next === chat.stage) return
    if (catalog.isLost(next) && razonPerdido === undefined) {
      setPendingLost(next)
      return
    }
    moveStage.mutate(
      { chatId: chat.chat_id, stage: next, razonPerdido },
      {
        onSuccess: () => toast.success(`Movido a ${catalog.label(next)}`),
        onError: (err) => toast.error(extractErrorMessage(err)),
      },
    )
  }

  function assign(sellerId: number | null) {
    if (sellerId === chat.vendedor_id) return
    updateLead(
      { vendedor_id: sellerId },
      {
        onSuccess: () => toast.success(sellerId === null ? 'Quedó sin asignar' : 'Vendedora asignada'),
        onError: (err) => toast.error(extractErrorMessage(err)),
      },
    )
  }

  const sellerName = chat.vendedor ?? 'Sin asignar'

  return (
    <div className="flex min-w-0 items-center gap-1">
      <DropdownMenu
        trigger={
          <button type="button" disabled={moveStage.isPending} aria-label={`Etapa: ${stage.name}. Cambiar etapa`} className={triggerClass}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden="true" />
            <span className="truncate">{stage.name}</span>
            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
          </button>
        }
      >
        {catalog.active.map((option) => (
          <DropdownMenuItem key={option.key} onSelect={() => move(option.key)}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: option.color }} aria-hidden="true" />
            <span className={option.key === chat.stage ? 'font-semibold' : undefined}>{option.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenu>

      <span className="text-xs text-fg-muted" aria-hidden="true">·</span>

      {isAdmin ? (
        <DropdownMenu
          trigger={
            <button type="button" disabled={isAssigning} aria-label={`Vendedora: ${sellerName}. Cambiar vendedora`} className={triggerClass}>
              <span className="truncate">{sellerName}</span>
              <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
            </button>
          }
        >
          {sellers.map((seller) => (
            <DropdownMenuItem key={seller.id} onSelect={() => assign(seller.id)}>
              <span className={seller.id === chat.vendedor_id ? 'font-semibold' : undefined}>{seller.name}</span>
            </DropdownMenuItem>
          ))}
          {sellers.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => assign(null)}>Sin asignar</DropdownMenuItem>
        </DropdownMenu>
      ) : (
        <span className="truncate px-1 text-xs font-medium text-fg-muted">{sellerName}</span>
      )}

      {pendingLost && (
        <LostReasonDialog
          count={1}
          stageName={catalog.label(pendingLost)}
          onCancel={() => setPendingLost(null)}
          onConfirm={(razon) => {
            const next = pendingLost
            setPendingLost(null)
            move(next, razon)
          }}
        />
      )}
    </div>
  )
}
