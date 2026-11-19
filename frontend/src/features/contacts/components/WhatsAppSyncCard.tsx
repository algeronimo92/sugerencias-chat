import { RefreshCw, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '../../../shared/ui/Badge'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { contactsLabel } from '../domain/selection'
import { useImportSummary, useRetryWhatsAppSync, useSetWhatsAppAutoImport, useWhatsAppSync } from '../hooks/useContacts'
import type { WhatsAppSyncItem } from '../types'

const STATUS: Record<WhatsAppSyncItem['status'], { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  requested: { label: 'Pedido a Meta', variant: 'info' },
  receiving: { label: 'Recibiendo', variant: 'info' },
  done: { label: 'Completo', variant: 'success' },
  failed: { label: 'Falló', variant: 'danger' },
  declined: { label: 'No compartido', variant: 'warning' },
}

const TYPE_LABEL: Record<WhatsAppSyncItem['sync_type'], string> = {
  smb_app_state_sync: 'Agenda del celular',
  history: 'Historial de chats',
}

function deadline(value: string | null) {
  return value ? new Date(value).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }) : ''
}

/** Lo que llega de la app WhatsApp Business del celular (coexistencia).
 *  Meta lo manda una sola vez, en las 24 h siguientes a conectar el número;
 *  después solo llegan los cambios de la agenda. */
export function WhatsAppSyncCard({ onReview }: { onReview: (batchId: string) => void }) {
  const { data: status } = useWhatsAppSync(true)
  const { data: pending } = useImportSummary(status?.open_batch_id ?? null)
  const setAutoImport = useSetWhatsAppAutoImport()
  const retry = useRetryWhatsAppSync()
  if (!status) return null
  const waiting = pending?.counts.pending ?? 0
  const canRetry = status.syncs.some(sync => sync.can_retry)

  function toggleAuto(enabled: boolean) {
    setAutoImport.mutate(enabled, {
      onError: err => toast.error('No se pudo guardar', { description: extractErrorMessage(err) }),
    })
  }

  function retrySync() {
    retry.mutate(undefined, {
      onSuccess: ({ retried }) => toast.success(retried.length ? 'Se volvió a pedir a Meta' : 'No quedaba nada por pedir'),
      onError: err => toast.error('Meta no aceptó el pedido', { description: extractErrorMessage(err) }),
    })
  }

  return (
    <section aria-label="Contactos del celular" className="rounded-xl border border-wa-border bg-white p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-wa-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-wa-text dark:text-white">Contactos del celular</h2>
            <p className="mt-0.5 text-sm text-wa-muted dark:text-wa-muted-dark">
              {waiting > 0
                ? `${contactsLabel(waiting)} de la app WhatsApp Business esperan que elijas cuáles importar.`
                : status.syncs.length > 0
                  ? 'Los cambios de la agenda del celular llegan solos.'
                  : 'Al conectar un número con la app WhatsApp Business, su agenda y sus chats recientes aparecen acá.'}
            </p>
            {status.syncs.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {status.syncs.map(sync => (
                  <li key={`${sync.phone_number_id}-${sync.sync_type}`}>
                    <Badge variant={STATUS[sync.status].variant} size="md" title={sync.error ?? undefined}>
                      {TYPE_LABEL[sync.sync_type]}: {STATUS[sync.status].label}
                      {sync.sync_type === 'history' && sync.progress != null && sync.status === 'receiving' ? ` ${sync.progress}%` : ''}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {canRetry && (
              <p className="mt-2 text-xs text-wa-muted dark:text-wa-muted-dark">
                Meta acepta el pedido hasta el {deadline(status.syncs.find(sync => sync.can_retry)?.window_ends_at ?? null)}.
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canRetry && (
            <Button variant="secondary" size="sm" onClick={retrySync} disabled={retry.isPending}>
              <RefreshCw className={retry.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden="true" />
              Volver a pedir
            </Button>
          )}
          {status.open_batch_id && waiting > 0 && (
            <Button size="sm" onClick={() => onReview(status.open_batch_id ?? '')}>Elegir cuáles importar</Button>
          )}
        </div>
      </div>
      <label className="mt-3 flex items-start gap-2 border-t border-wa-border pt-3 text-sm text-wa-text dark:border-wa-border-dark dark:text-wa-text-dark">
        <Checkbox checked={status.auto_import} onCheckedChange={toggleAuto} disabled={setAutoImport.isPending} className="mt-0.5" />
        <span>
          Agregar solos los contactos nuevos que guarden en el celular
          <span className="block text-xs text-wa-muted dark:text-wa-muted-dark">Apagado, esperan acá a que alguien los elija.</span>
        </span>
      </label>
    </section>
  )
}
