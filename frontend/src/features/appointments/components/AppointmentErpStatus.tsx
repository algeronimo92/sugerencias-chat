import { ExternalLink, RefreshCw } from 'lucide-react'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useSyncAppointmentErp, type AppointmentListItem } from '../queries'

const STATUS_LABELS: Record<string, string> = {
  synced: 'En la agenda del ERP',
  pending: 'Pendiente de enviar al ERP',
  error: 'No llegó al ERP',
}

/**
 * Qué pasó con el envío de la cita al ERP del negocio. Solo aparece si el
 * envío existió o está activo: una cita anterior a la integración no muestra
 * nada salvo que ahora se pueda enviar.
 */
export function AppointmentErpStatus({ item, erpActive }: { item: AppointmentListItem; erpActive: boolean }) {
  const sync = useSyncAppointmentErp()
  const status = item.erp_sync_status ?? 'not_configured'
  const sent = status === 'synced'
  const retryable = erpActive && !sent && !item.test_mode && !item.dismissed_at
  if (!sent && !retryable && status !== 'error') return null

  const label = STATUS_LABELS[status] ?? 'Sin enviar al ERP'
  const pending = sync.isPending && sync.variables === item.id
  const failed = sync.isError && sync.variables === item.id

  return (
    <div className="mt-2 rounded-lg border border-wa-border px-3 py-2 text-xs dark:border-wa-border-dark">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={sent ? 'font-medium text-wa-primary-strong dark:text-wa-primary' : 'font-medium text-amber-700 dark:text-amber-300'}>
          {label}
        </span>
        {item.package_name && <span className="text-wa-muted">Paquete: {item.package_name}</span>}
        {retryable && (
          <button
            type="button"
            onClick={() => sync.mutate(item.id)}
            disabled={sync.isPending}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-wa-primary-strong hover:bg-green-50 disabled:opacity-50 dark:text-wa-primary dark:hover:bg-green-950/30"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} aria-hidden="true" />
            Enviar al ERP
          </button>
        )}
        {item.erp_link && (
          <a href={item.erp_link} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-wa-primary-strong hover:bg-green-50 dark:text-wa-primary dark:hover:bg-green-950/30">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Ver en el ERP
          </a>
        )}
      </div>
      {!sent && item.erp_sync_error && !failed && (
        <p className="mt-1 text-amber-800 dark:text-amber-300">{item.erp_sync_error}</p>
      )}
      {failed && <p role="alert" className="mt-1 text-red-600 dark:text-red-400">{extractErrorMessage(sync.error)}</p>}
    </div>
  )
}
