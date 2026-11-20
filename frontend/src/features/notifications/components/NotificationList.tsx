import { Bell, BellOff, Loader2 } from 'lucide-react'
import { Button } from '../../../shared/ui/Button'
import type { UserNotification } from '../types'
import { NotificationRow } from './NotificationRow'

interface Props {
  notifications: UserNotification[]
  unreadOnly: boolean
  isAdmin: boolean
  isLoading: boolean
  isError: boolean
  error: unknown
  isFetching: boolean
  onRetry: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  onOpen: (notification: UserNotification) => void
}

/** Cuerpo del centro de notificaciones: carga, error, vacío o la lista con
 * su botón para traer las anteriores. */
export function NotificationList({
  notifications,
  unreadOnly,
  isAdmin,
  isLoading,
  isError,
  error,
  isFetching,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onOpen,
}: Props) {
  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-wa-muted" /></div>
  }

  if (isError) {
    return (
      <div className="px-5 py-10 text-center">
        <BellOff className="mx-auto mb-2 h-7 w-7 text-red-300 dark:text-red-700" />
        <p className="text-sm font-medium text-red-600 dark:text-red-400">No se pudo cargar el historial</p>
        <p className="mt-1 text-[10px] text-wa-muted">{error instanceof Error ? error.message : 'Error de conexión'}</p>
        <Button variant="secondary" size="sm" onClick={onRetry} disabled={isFetching} className="mt-3">
          {isFetching && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          Reintentar
        </Button>
      </div>
    )
  }

  if (notifications.length === 0) {
    return (
      <div className="px-5 py-14 text-center">
        <Bell className="mx-auto mb-2 h-7 w-7 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-wa-muted dark:text-wa-muted-dark">{unreadOnly ? 'No tienes notificaciones pendientes' : 'Todavía no tienes notificaciones'}</p>
      </div>
    )
  }

  return (
    <>
      {notifications.map(notification => (
        <NotificationRow key={notification.id} notification={notification} isAdmin={isAdmin} onOpen={onOpen} />
      ))}
      {hasNextPage && (
        <div className="p-3 text-center">
          <button type="button" onClick={onLoadMore} disabled={isFetchingNextPage} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium text-wa-primary-strong hover:bg-green-50 disabled:opacity-40 dark:text-wa-primary dark:hover:bg-green-950/40">
            {isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isFetchingNextPage ? 'Cargando...' : 'Cargar notificaciones anteriores'}
          </button>
        </div>
      )}
    </>
  )
}
