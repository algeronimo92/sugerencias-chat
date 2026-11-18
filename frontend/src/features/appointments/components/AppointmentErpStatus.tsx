import { ExternalLink, RefreshCw } from 'lucide-react'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { erpStatusView } from '../domain/erpStatus'
import { useSyncAppointmentErp, type AppointmentListItem } from '../queries'

const actionClass = 'ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-wa-primary-strong hover:bg-green-50 disabled:opacity-50 dark:text-wa-primary dark:hover:bg-green-950/30'

/**
 * Qué pasó con el envío de la cita al ERP del negocio: si ya está en su
 * agenda, por qué no llegó, y la forma de reenviarla o abrirla allá. Qué se
 * muestra lo decide ``erpStatusView``.
 */
export function AppointmentErpStatus({ item, erpActive }: { item: AppointmentListItem; erpActive: boolean }) {
  const sync = useSyncAppointmentErp()
  const view = erpStatusView(item, erpActive)
  if (view === null) return null

  const mine = sync.variables === item.id
  // El motivo del reintento que acaba de fallar reemplaza al guardado.
  const retryError = sync.isError && mine ? extractErrorMessage(sync.error) : null

  return (
    <div className="mt-2 rounded-lg border border-wa-border px-3 py-2 text-xs dark:border-wa-border-dark">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={view.sent ? 'font-medium text-wa-primary-strong dark:text-wa-primary' : 'font-medium text-amber-700 dark:text-amber-300'}>
          {view.label}
        </span>
        {item.package_name && <span className="text-wa-muted">Paquete: {item.package_name}</span>}
        {view.retryable && (
          <button type="button" onClick={() => sync.mutate(item.id)} disabled={sync.isPending} className={actionClass}>
            <RefreshCw className={`h-3.5 w-3.5 ${sync.isPending && mine ? 'animate-spin' : ''}`} aria-hidden="true" />
            Enviar al ERP
          </button>
        )}
        {item.erp_link && (
          <a href={item.erp_link} target="_blank" rel="noreferrer" className={actionClass}>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Ver en el ERP
          </a>
        )}
      </div>
      <ErrorLine saved={view.error} retry={retryError} />
    </div>
  )
}

function ErrorLine({ saved, retry }: { saved: string | null; retry: string | null }) {
  if (retry) return <p role="alert" className="mt-1 text-red-600 dark:text-red-400">{retry}</p>
  if (saved) return <p className="mt-1 text-amber-800 dark:text-amber-300">{saved}</p>
  return null
}
