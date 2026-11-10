import { Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useDeleteLeadSale, useLeadSales, useRecordLeadSale } from '../hooks/useLeadSales'
import type { Chat, LeadSale } from '../types'
import { displayName } from '../utils/chat'
import { SaleDialog } from './SaleDialog'

/** Importes sin moneda: la del negocio vive en el perfil IA y acá basta con el número. */
function formatAmount(value: string | number): string {
  return Number(value).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function saleTotal(sales: LeadSale[]): number {
  return sales.reduce((sum, sale) => sum + Number(sale.amount), 0)
}

/**
 * Compras del lead en la ficha: con qué paquete cerró cada vez, cuánto pagó y
 * quién vendió. Desde acá también se registra una compra que no entró al
 * mover de etapa (una segunda compra, o un cierre que se movió sin anotar).
 */
export function LeadSalesSection({ chat }: { chat: Chat }) {
  const { data: sales = [], isLoading } = useLeadSales(chat.chat_id)
  const record = useRecordLeadSale(chat.chat_id)
  const remove = useDeleteLeadSale(chat.chat_id)
  const [adding, setAdding] = useState(false)

  function handleDelete(sale: LeadSale) {
    if (!window.confirm(`¿Eliminar la compra de ${sale.package_name} (${sale.service_name})?`)) return
    remove.mutate(sale.id, {
      onSuccess: () => toast.success('Compra eliminada'),
      onError: err => toast.error(extractErrorMessage(err)),
    })
  }

  return (
    <div className="mt-4 border-t border-wa-border pt-3 dark:border-wa-border-dark">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
          <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
          Compras
          {sales.length > 0 && <span className="normal-case tracking-normal">· total {formatAmount(saleTotal(sales))}</span>}
        </h4>
        {/* Discreto a propósito: la venta se registra al separar la cita y esto
            quedó para los negocios que además anotan el paquete. Con el verde
            de acción competía con "Separar cita", justo debajo. */}
        <button type="button" onClick={() => setAdding(true)} className="inline-flex min-h-6 items-center gap-1 rounded text-xs font-medium text-wa-muted hover:text-wa-text hover:underline dark:text-wa-muted-dark dark:hover:text-wa-text-dark">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Registrar compra
        </button>
      </div>

      {isLoading ? (
        <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Cargando…</p>
      ) : sales.length === 0 ? (
        <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Todavía no compró nada.</p>
      ) : (
        <ul className="space-y-2" aria-label="Compras del lead">
          {sales.map(sale => (
            <li key={sale.id} className="flex items-start justify-between gap-2 text-sm">
              <div className="min-w-0">
                <p className="truncate text-gray-700 dark:text-gray-300">
                  <span className="font-medium">{sale.package_name}</span>
                  <span className="text-wa-muted dark:text-wa-muted-dark"> · {sale.service_name}</span>
                </p>
                <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
                  {new Date(sale.sold_at).toLocaleDateString('es-PE')}
                  {sale.sold_by_name ? ` · ${sale.sold_by_name}` : ''}
                  {sale.notes ? ` · ${sale.notes}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="tabular-nums text-gray-700 dark:text-gray-300" title={Number(sale.amount) !== Number(sale.list_price) ? `Precio de lista: ${formatAmount(sale.list_price)}` : undefined}>
                  {formatAmount(sale.amount)}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(sale)}
                  disabled={remove.isPending}
                  aria-label={`Eliminar compra ${sale.package_name}`}
                  className="text-wa-muted transition-colors hover:text-red-600 disabled:opacity-50 dark:text-wa-muted-dark dark:hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <SaleDialog
          leadName={displayName(chat)}
          defaultServiceName={chat.servicio_interes}
          isPending={record.isPending}
          onCancel={() => setAdding(false)}
          onConfirm={sale => {
            if (!sale) return
            record.mutate(sale, {
              onSuccess: () => { setAdding(false); toast.success('Compra registrada') },
              onError: err => toast.error(extractErrorMessage(err)),
            })
          }}
        />
      )}
    </div>
  )
}
