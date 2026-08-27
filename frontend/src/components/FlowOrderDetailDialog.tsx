import { ReceiptText, X } from 'lucide-react'

import {
  formatFlowAmount, ORDER_STATUS_LABELS, flowStatusLabel,
  type FlowOrderButton, type FlowOrderGroup,
} from '../utils/message'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'

interface Props {
  /** El botón `review_and_pay` del pedido: trae el `reference_id` y sirve de
   * respaldo cuando el grupo correlacionado no encontró algún campo. */
  button: FlowOrderButton
  /** Estado agregado del pedido, correlacionado entre sus 3 mensajes. */
  group: FlowOrderGroup
  onClose: () => void
}

function DetailRow({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? 'font-semibold text-wa-text dark:text-wa-text-dark' : 'text-wa-muted dark:text-wa-muted-dark'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

/** Modal de detalle de un pedido de WhatsApp Flow ("Ver detalles" de la
 * tarjeta de pedido). El estado y los datos del pedido vienen ya
 * correlacionados entre los 3 mensajes del grupo (ver `flowOrderGroup`), no
 * solo del mensaje `review_and_pay` que abrió el modal. */
export function FlowOrderDetailDialog({ button, group, onClose }: Props) {
  const orderStatusLabel = flowStatusLabel(group.orderStatus, ORDER_STATUS_LABELS)
  const itemName = group.itemName ?? button.item_name
  const quantity = group.quantity ?? button.quantity
  const currency = group.currency ?? button.currency
  const amountText = formatFlowAmount(group.amount ?? button.amount, currency)
  const subtotalText = formatFlowAmount(group.subtotal ?? button.subtotal, currency)

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content
          aria-describedby={undefined}
          className={`${dialogContentPositionClass} w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
        >
          <div className="flex items-center justify-between border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
            <Dialog.Title className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">
              Detalles del pedido
            </Dialog.Title>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="text-wa-muted transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3 p-4">
            {orderStatusLabel && (
              <span className="inline-flex w-fit rounded-full bg-wa-primary/15 px-2.5 py-1 text-xs font-semibold text-wa-primary-strong dark:text-wa-primary">
                {orderStatusLabel}
              </span>
            )}

            <div className="rounded-xl border border-wa-border bg-wa-app px-3 py-2.5 dark:border-wa-border-dark dark:bg-wa-app-dark">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wa-primary/15 text-wa-primary-strong dark:text-wa-primary">
                  <ReceiptText className="h-4 w-4" aria-hidden="true" />
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-wa-text dark:text-wa-text-dark">
                  {itemName || `Pedido N.° ${button.reference_id}`}
                </p>
              </div>

              {(quantity != null || amountText) && (
                <div className="mt-2.5 flex items-center justify-between text-sm text-wa-muted dark:text-wa-muted-dark">
                  <span>{quantity != null ? `Cantidad: ${quantity}` : ''}</span>
                  {amountText && <span className="font-medium tabular-nums text-wa-text dark:text-wa-text-dark">{amountText}</span>}
                </div>
              )}

              {(subtotalText || amountText) && (
                <div className="mt-2.5 space-y-1 border-t border-wa-border pt-2.5 text-sm dark:border-wa-border-dark">
                  {subtotalText && <DetailRow label="Subtotal" value={subtotalText} />}
                  {amountText && <DetailRow label="Total" value={amountText} bold />}
                </div>
              )}
            </div>

            <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">Pedido N.° {button.reference_id}</p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
