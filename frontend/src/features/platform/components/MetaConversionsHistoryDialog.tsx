import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { DialogPrimitive, dialogContentPositionClass, dialogOverlayClass } from '../../../shared/ui/Dialog'
import { CONVERSION_EVENTS_PAGE_SIZE, useMetaConversionEvents } from '../hooks/useWhatsapp'
import type { MetaConversionItem } from '../types'
import { STATUS_ICONS, STATUS_LABELS, eventLabel } from './metaConversionLabels'

const muted = 'text-wa-muted dark:text-wa-muted-dark'

function StatusIcon({ status }: { status: MetaConversionItem['status'] }) {
  const { Icon, className } = STATUS_ICONS[status]
  return <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${className}`} aria-hidden="true" />
}

function EventRow({ item }: { item: MetaConversionItem }) {
  const amount = item.value == null ? '' : ` · ${item.value.toFixed(2)}${item.currency ? ` ${item.currency}` : ''}`
  const reason = item.status === 'skipped' && item.skip_reason ? `: ${item.skip_reason}` : ''
  return (
    <li className="flex items-start gap-2 py-2">
      <StatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-wa-text dark:text-wa-text-dark">
          {item.lead_name || 'Lead'} · {eventLabel(item.event_name)}
          <span className={muted}>{amount}</span>
        </p>
        <p className={`text-[11px] ${muted}`}>
          {STATUS_LABELS[item.status]}{reason} · {new Date(item.sent_at ?? item.created_at).toLocaleString()}
        </p>
        {item.status === 'failed' && item.last_error && (
          <p className="break-words text-[11px] text-red-600 dark:text-red-400">{item.last_error}</p>
        )}
      </div>
    </li>
  )
}

/** Historial de eventos de la API de Conversiones, aparte de la tarjeta y de
 *  a una página: dentro de la tarjeta ocupaba más que la configuración. */
export function MetaConversionsHistoryDialog({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(1)
  const { data, isLoading, isError, isFetching } = useMetaConversionEvents(page)
  const pages = data ? Math.max(1, Math.ceil(data.total / CONVERSION_EVENTS_PAGE_SIZE)) : 1

  let body
  if (isLoading) body = <p className={`py-6 text-center text-xs ${muted}`}>Cargando…</p>
  else if (isError || !data) body = <p className="py-6 text-center text-xs text-red-600 dark:text-red-400">No se pudo cargar el historial.</p>
  else if (data.items.length === 0) body = <p className={`py-6 text-center text-xs ${muted}`}>Todavía no hay eventos de leads que llegaron por un anuncio.</p>
  else {
    body = (
      <ul className="divide-y divide-wa-border text-xs dark:divide-wa-border-dark">
        {data.items.map((item) => <EventRow key={item.id} item={item} />)}
      </ul>
    )
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={dialogOverlayClass} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={`${dialogContentPositionClass} flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg flex-col rounded-2xl border border-wa-border bg-white text-wa-text shadow-2xl dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark`}
        >
          <header className="flex items-center justify-between gap-2 border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-sm font-semibold">Historial de eventos</DialogPrimitive.Title>
              <p className={`text-[11px] ${muted}`}>
                Leads que llegaron por un anuncio{data ? ` · ${data.total} eventos` : ''}
              </p>
            </div>
            <DialogPrimitive.Close asChild>
              <button type="button" aria-label="Cerrar" className="rounded-md p-1.5 text-wa-muted hover:bg-wa-field dark:text-wa-muted-dark dark:hover:bg-wa-field-dark">
                <X className="h-4 w-4" />
              </button>
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">{body}</div>
          {data && data.total > CONVERSION_EVENTS_PAGE_SIZE && (
            <footer className="flex items-center justify-between gap-2 border-t border-wa-border px-4 py-2.5 dark:border-wa-border-dark">
              <Button variant="secondary" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage((value) => value - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Anterior
              </Button>
              <span className={`inline-flex items-center gap-1.5 text-xs tabular-nums ${muted}`}>
                {isFetching && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                Página {page} de {pages}
              </span>
              <Button variant="secondary" size="sm" disabled={page >= pages || isFetching} onClick={() => setPage((value) => value + 1)}>
                Siguiente
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
