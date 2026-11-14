import { AlertCircle, CheckCircle2, Clock, Loader2, Megaphone } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMetaConversions, useSaveMetaConversions } from '../hooks/useWhatsapp'
import type { MetaConversionItem } from '../types'

const STATUS_LABELS: Record<MetaConversionItem['status'], string> = {
  sent: 'Enviado a Meta',
  pending: 'En cola',
  failed: 'No se pudo enviar',
}

function StatusIcon({ status }: { status: MetaConversionItem['status'] }) {
  if (status === 'sent') return <CheckCircle2 className="h-3.5 w-3.5 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />
  if (status === 'failed') return <AlertCircle className="h-3.5 w-3.5 text-red-500 dark:text-red-400" aria-hidden="true" />
  return <Clock className="h-3.5 w-3.5 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
}

/** Cuando un lead que llegó por un anuncio de clic a WhatsApp agenda una
 *  cita, el CRM se lo informa a Meta (API de Conversiones). Así la campaña
 *  aprende qué clics terminan en cita y el Administrador de anuncios muestra
 *  cuántas citas trajo cada anuncio. */
export function MetaConversionsPanel() {
  const { data, isLoading, isError } = useMetaConversions()
  const { mutate: save, isPending } = useSaveMetaConversions()

  function toggle(enabled: boolean) {
    save(enabled, {
      onSuccess: () => toast.success(enabled ? 'Las citas de anuncios se informarán a Meta' : 'Envío a Meta pausado'),
      onError: (error) => toast.error(extractErrorMessage(error)),
    })
  }

  return (
    <section className="space-y-3 rounded-lg border border-wa-border p-3 dark:border-wa-border-dark">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-wa-text dark:text-wa-text-dark">
          <Megaphone className="h-4 w-4" aria-hidden="true" />
          Conversiones de anuncios (Meta)
        </h3>
        {data && (
          <Button variant={data.enabled ? 'secondary' : 'primary'} size="sm" onClick={() => toggle(!data.enabled)} disabled={isPending}>
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {data.enabled ? 'Pausar' : 'Activar'}
          </Button>
        )}
      </div>

      <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
        Cuando un cliente que escribió desde un anuncio de clic a WhatsApp agenda una cita, se le informa a Meta como
        «LeadSubmitted». La campaña aprende qué clics terminan en cita y el Administrador de anuncios las cuenta por anuncio.
      </p>

      {isLoading ? (
        <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Cargando…</p>
      ) : isError || !data ? (
        <p className="text-xs text-red-600 dark:text-red-400">No se pudo cargar el estado de las conversiones.</p>
      ) : (
        <>
          <p className="text-xs text-wa-text dark:text-wa-text-dark">
            {data.enabled ? (
              <>Activo{data.dataset_id && <span className="text-wa-muted dark:text-wa-muted-dark"> · dataset {data.dataset_id}</span>}</>
            ) : (
              'Pausado: las citas no se informan a Meta.'
            )}
          </p>
          <p className="text-xs tabular-nums text-wa-muted dark:text-wa-muted-dark">
            Últimos {data.days} días: {data.sent} enviados · {data.pending} en cola · {data.failed} con error
          </p>

          {data.recent.length > 0 ? (
            <ul className="divide-y divide-wa-border text-xs dark:divide-wa-border-dark">
              {data.recent.map((item) => (
                <li key={item.id} className="flex items-start gap-2 py-1.5">
                  <StatusIcon status={item.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-wa-text dark:text-wa-text-dark">
                      {item.lead_name || 'Lead'}
                      {item.appointment_id != null && <span className="text-wa-muted dark:text-wa-muted-dark"> · cita #{item.appointment_id}</span>}
                    </p>
                    <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
                      {item.event_name} · {STATUS_LABELS[item.status]} · {new Date(item.sent_at ?? item.created_at).toLocaleString()}
                    </p>
                    {item.status !== 'sent' && item.last_error && (
                      <p className="break-words text-[11px] text-red-600 dark:text-red-400">{item.last_error}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
              Todavía no hay citas de leads que llegaron por un anuncio.
            </p>
          )}
        </>
      )}
    </section>
  )
}
