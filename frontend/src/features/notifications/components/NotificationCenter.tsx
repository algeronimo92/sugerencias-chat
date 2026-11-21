import { CheckCheck, Loader2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useDismissiblePopover } from '../../../shared/hooks/useDismissiblePopover'
import { useMe } from '../../auth/public/queries'
import { can } from '../../../shared/permissions'
import type { UserNotification } from '../types'
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotificationHistory } from '../hooks/useNotificationHistory'
import type { NotificationPermissionState } from '../hooks/useNotifications'
import { usePanelRoom } from '../hooks/usePanelRoom'
import { usePushSubscription } from '../hooks/usePushSubscription'
import { BrowserPermissionFooter } from './BrowserPermissionFooter'
import { NotificationBellButton, type NotificationPlacement } from './NotificationBellButton'
import { NotificationList } from './NotificationList'

interface Props {
  /**
   * `header`: icono de la barra superior del celular (el panel abre abajo).
   * `rail`: ítem del riel compacto (abre al costado).
   * `toolbar`: icono de la fila de herramientas del riel expandido (abre arriba).
   */
  placement?: NotificationPlacement
  browserPermission: NotificationPermissionState
  onRequestBrowserPermission: () => void
  onNewNotification: (notification: {
    notificationId: number
    leadId: string
    authorName: string
    content: string
  }) => void
}

const PANEL_POSITION = { header: 'sm:right-0 sm:top-11', rail: 'sm:bottom-0 sm:left-full sm:top-auto sm:ml-2', toolbar: 'sm:bottom-full sm:left-0 sm:top-auto sm:mb-2' }

const FILTER_ACTIVE = 'bg-fg text-surface'
const FILTER_IDLE = 'text-wa-muted hover:bg-wa-field dark:text-wa-muted-dark dark:hover:bg-wa-head-dark'

/** Adónde lleva tocar una notificación (null = a ningún lado). */
function notificationTarget(notification: UserNotification): string | null {
  if (notification.notification_type === 'issue_report') {
    const reportId = notification.metadata?.issue_report_id
    return typeof reportId === 'number' && reportId ? `/reports?report=${reportId}` : '/reports'
  }
  if (notification.notification_type === 'appointment') return '/citas/nueva'
  return notification.lead_id ? `/chat/${notification.lead_id}` : null
}

function authorName(notification: UserNotification): string {
  const name = notification.metadata?.author_name
  return typeof name === 'string' ? name : 'Un usuario'
}

export function NotificationCenter({ browserPermission, onRequestBrowserPermission, onNewNotification, placement = 'header' }: Props) {
  const navigate = useNavigate()
  const { data: me } = useMe()
  // Reintentar un flujo frenado por la ventana de 24 h.
  const isAdmin = can(me, 'automations.manage')
  const { subscribed: pushSubscribed, subscribe: subscribeToPush } = usePushSubscription()
  const [open, setOpen] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const history = useNotificationHistory(unreadOnly, open ? 50 : 1)
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const rootRef = useDismissiblePopover<HTMLDivElement>(open, () => setOpen(false))
  const panelRoom = usePanelRoom(open, placement, rootRef)
  const lastSurfacedIdRef = useRef(0)
  const unreadCount = history.data?.pages[0]?.unread_count ?? 0
  const notifications = history.data?.pages.flatMap(page => page.items) ?? []
  const latestUnread = notifications.find(notification => !notification.read_at)

  useEffect(() => {
    if (!latestUnread || latestUnread.id <= lastSurfacedIdRef.current || !latestUnread.lead_id) return
    lastSurfacedIdRef.current = latestUnread.id
    onNewNotification({
      notificationId: latestUnread.id,
      leadId: latestUnread.lead_id,
      authorName: authorName(latestUnread),
      content: latestUnread.body,
    })
  }, [latestUnread, onNewNotification])

  // El permiso de `Notification` es el mismo que gobierna Push, así que
  // cualquier momento en que quede en 'granted' es una oportunidad de
  // suscribirse: cubre tanto el click en "Activar avisos" como a quienes ya
  // habían aceptado el permiso antes de que existiera Push (para esos, el
  // botón de abajo ni siquiera se muestra, porque ya está en 'granted').
  useEffect(() => {
    if (browserPermission !== 'granted' || pushSubscribed) return
    subscribeToPush().catch(() => toast.error('No se pudo activar el envío de notificaciones push'))
  }, [browserPermission, pushSubscribed, subscribeToPush])

  function openNotification(notification: UserNotification) {
    if (!notification.read_at) markRead.mutate(notification.id)
    setOpen(false)
    const target = notificationTarget(notification)
    if (target) navigate(target)
  }

  return (
    <div ref={rootRef} className="relative">
      <NotificationBellButton
        placement={placement}
        open={open}
        unreadCount={unreadCount}
        onToggle={() => setOpen(current => !current)}
      />

      {open && (
        <div className={`fixed inset-x-3 top-[calc(env(safe-area-inset-top)+3.25rem)] z-[80] flex max-h-[min(620px,calc(100vh-5rem))] flex-col overflow-hidden rounded-xl border border-line bg-surface-raised shadow-overlay sm:absolute sm:inset-x-auto sm:w-96 sm:max-w-[calc(100vw-2rem)] ${PANEL_POSITION[placement]}`}
          style={panelRoom === null ? undefined : { maxHeight: panelRoom }}
        >
          <header className="flex items-center justify-between gap-3 border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
            <div>
              <h2 className="text-sm font-semibold text-wa-text dark:text-white">Notificaciones</h2>
              <p className="text-[10px] text-wa-muted">{unreadCount ? `${unreadCount} sin leer` : 'Todo al día'}</p>
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button type="button" onClick={() => markAll.mutate()} disabled={markAll.isPending} title="Marcar todas como leídas" className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium text-wa-primary-strong hover:bg-green-50 disabled:opacity-40 dark:text-wa-primary dark:hover:bg-green-950/40">
                  {markAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />} Marcar todas
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-wa-muted hover:bg-wa-field dark:hover:bg-wa-head-dark"><X className="h-4 w-4" /></button>
            </div>
          </header>

          <div className="flex gap-1 border-b border-wa-border px-3 py-2 dark:border-wa-border-dark">
            <button type="button" onClick={() => setUnreadOnly(false)} className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${unreadOnly ? FILTER_IDLE : FILTER_ACTIVE}`}>Todas</button>
            <button type="button" onClick={() => setUnreadOnly(true)} className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${unreadOnly ? FILTER_ACTIVE : FILTER_IDLE}`}>No leídas</button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <NotificationList
              notifications={notifications}
              unreadOnly={unreadOnly}
              isAdmin={isAdmin}
              isLoading={history.isLoading}
              isError={history.isError}
              error={history.error}
              isFetching={history.isFetching}
              onRetry={() => history.refetch()}
              hasNextPage={history.hasNextPage}
              isFetchingNextPage={history.isFetchingNextPage}
              onLoadMore={() => history.fetchNextPage()}
              onOpen={openNotification}
            />
          </div>

          <BrowserPermissionFooter
            browserPermission={browserPermission}
            onRequestBrowserPermission={onRequestBrowserPermission}
          />
        </div>
      )}
    </div>
  )
}
