import { ShoppingBag, Trash2 } from 'lucide-react'
import type { LeadActivity } from '../../leads/types'
import { formatMessageTime } from '../../whatsapp/public/message'

function text(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function actorLabel(activity: LeadActivity): string {
  if (activity.actor_name) return activity.actor_name
  return activity.actor_type === 'agent' ? 'Agente IA' : 'Sistema'
}

/** Una compra en el hilo del chat, en el momento en que se registró: los
 *  mensajes de arriba son la conversación que la cerró. */
export function SaleCard({ activity }: { activity: LeadActivity }) {
  const deleted = activity.event_type === 'sale_deleted'
  const sale = (deleted ? activity.old_value : activity.new_value) ?? null
  const service = text(sale?.service)
  const pkg = text(sale?.package)
  const amount = text(sale?.amount)
  const sessions = text(sale?.sessions)
  if (!pkg) return null

  return (
    <div className="my-2 flex justify-center">
      <div className={`max-w-[85%] rounded-xl border px-3.5 py-2 text-center shadow-sm ${deleted ? 'border-dashed border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-head-dark' : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40'}`}>
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs font-semibold text-wa-text dark:text-wa-text-dark">
          {deleted
            ? <Trash2 className="h-3.5 w-3.5 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
            : <ShoppingBag className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />}
          <span>{deleted ? 'Compra eliminada' : 'Compró'} {pkg}{service ? ` de ${service}` : ''}</span>
          {amount && <span className="tabular-nums">· {Number(amount).toLocaleString('es-PE', { maximumFractionDigits: 2 })}</span>}
        </div>
        <p className="mt-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">
          {sessions ? `${sessions} ${sessions === '1' ? 'sesión' : 'sesiones'} · ` : ''}
          {deleted ? 'Eliminada por' : 'Registrada por'} {actorLabel(activity)} · {formatMessageTime(activity.created_at)}
        </p>
      </div>
    </div>
  )
}
