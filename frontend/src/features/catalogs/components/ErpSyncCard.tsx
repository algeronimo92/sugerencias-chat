import { Link2, Link2Off, Loader2, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Skeleton } from '../../../shared/ui/Skeleton'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useErpSyncStatus, useRunErpSync } from '../hooks/useLeadServices'
import type { ErpSyncSummary } from '../types'

/**
 * Estado de la lista de precios respecto del ERP del negocio. Cuando hay un
 * ERP conectado, él manda: los servicios que trae se muestran en solo
 * lectura y acá se ve cuándo se trajeron por última vez y qué cambió.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function describe(summary: ErpSyncSummary): string {
  const parts = [`${summary.services_total} ${summary.services_total === 1 ? 'servicio' : 'servicios'} en el ERP`]
  if (summary.services_created) parts.push(`${summary.services_created} nuevos`)
  if (summary.services_updated) parts.push(`${summary.services_updated} actualizados`)
  if (summary.services_deactivated) parts.push(`${summary.services_deactivated} desactivados`)
  const packages = summary.packages_created + summary.packages_updated + summary.packages_deactivated
  if (packages) parts.push(`${packages} ${packages === 1 ? 'paquete con cambios' : 'paquetes con cambios'}`)
  return parts.join(' · ')
}

export function ErpSyncCard() {
  const { data: status, isLoading } = useErpSyncStatus()
  const runSync = useRunErpSync()

  function handleSync() {
    runSync.mutate(undefined, {
      onSuccess: result => {
        const total = result.last_summary?.services_total ?? 0
        toast.success(`Catálogo sincronizado: ${total} ${total === 1 ? 'servicio' : 'servicios'}`)
      },
      onError: err => toast.error(extractErrorMessage(err)),
    })
  }

  if (isLoading) {
    return (
      <div className="mb-4 rounded-xl border border-wa-border bg-white p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark" aria-busy="true">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-2 h-3 w-72" />
      </div>
    )
  }
  if (!status) return null

  if (!status.configured) {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-dashed border-wa-border bg-white p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <Link2Off className="mt-0.5 h-5 w-5 shrink-0 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Sin ERP conectado</p>
          <p className="mt-1 text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
            Si tu negocio ya tiene la lista de precios en un ERP, conéctalo en{' '}
            <Link to="/integraciones#erp" className="font-medium text-wa-primary-strong underline dark:text-wa-primary">Integraciones</Link>
            {' '}y los servicios y paquetes se traerán solos cada hora.
          </p>
        </div>
      </div>
    )
  }

  const syncedAt = status.synced_at ? new Date(status.synced_at) : null
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-wa-border bg-white p-4 sm:flex-row sm:items-start sm:justify-between dark:border-wa-border-dark dark:bg-wa-panel-dark">
      <div className="flex min-w-0 items-start gap-3">
        <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">
            Lista de precios del ERP <span className="font-normal text-wa-muted dark:text-wa-muted-dark">· {hostOf(status.url ?? '')}</span>
          </p>
          <p className="mt-1 text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
            {syncedAt
              ? `Última sincronización: ${syncedAt.toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' })}`
              : 'Todavía no se sincronizó.'}
            {status.last_summary ? ` · ${describe(status.last_summary)}` : ''}
          </p>
          {status.last_summary?.conflicts.length ? (
            <p className="mt-1 text-sm leading-6 text-amber-700 dark:text-amber-300">
              No se pudieron aplicar (chocan con un servicio cargado a mano): {status.last_summary.conflicts.join(', ')}
            </p>
          ) : null}
          {status.last_error && (
            <p role="alert" className="mt-1 text-sm leading-6 text-red-700 dark:text-red-300">
              Último intento fallido: {status.last_error}
            </p>
          )}
          <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
            Los servicios y paquetes del ERP se editan allí; acá solo la descripción y las notas para el asistente IA.
          </p>
        </div>
      </div>
      <Button
        variant="secondary"
        className="h-10 shrink-0"
        onClick={handleSync}
        disabled={runSync.isPending}
        aria-label="Sincronizar ahora con el ERP"
      >
        {runSync.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
        Sincronizar ahora
      </Button>
    </div>
  )
}
